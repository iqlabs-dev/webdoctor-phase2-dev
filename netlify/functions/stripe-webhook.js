// netlify/functions/stripe-webhook.js

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// connect to supabase (service role so we can write)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// map Stripe price IDs → internal plan names + caps
const PLAN_MAP = {
  // you set these in Netlify
  [process.env.PRICE_ID_TRIAL]: {
    plan_type: "trial",
    soft_cap: 10,
  },
  [process.env.PRICE_ID_SCAN]: {
    plan_type: "scan",
    soft_cap: 50,
  },
  [process.env.PRICE_ID_DIAGNOSE]: {
    plan_type: "diagnose",
    soft_cap: 150,
  },
  [process.env.PRICE_ID_REVIVE]: {
    plan_type: "revive",
    soft_cap: 300,
  },
  [process.env.PRICE_ID_ENTERPRISE]: {
    plan_type: "enterprise",
    soft_cap: 999999, // practically unlimited
  },
};

export default async function handler(event) {
  // 1) verify it's from Stripe
  const sig = event.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;

    stripeEvent = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("⚠️ Webhook verify failed", err.message);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`,
    };
  }

  // we care about: checkout completed, subscription created, invoice paid, usage → overage
  const type = stripeEvent.type;
  console.log("➡️ stripe event:", type);

  try {
    switch (type) {
      // 1. a checkout finished (good place to set plan)
      case "checkout.session.completed": {
        const session = stripeEvent.data.object;
        const customerEmail =
          session.customer_details?.email || session.customer_email;

        // price can be on line_items, but for simple subs it's here:
        const priceId = session.metadata?.price_id || session.mode === "subscription"
          ? session.subscription // we’ll handle in subscription.created
          : null;

        // if this was a one-off, we may not need to do anything
        if (!customerEmail) {
          console.log("No email on checkout, skipping");
          break;
        }

        // we don’t always know the plan here, so just ensure user exists
        await ensureUserRow(customerEmail);
        break;
      }

      // 2. subscription is created → now we know exactly which price is active
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = stripeEvent.data.object;
        const customerId = sub.customer;

        // fetch customer to get email
        const customer = await stripe.customers.retrieve(customerId);
        const email = (customer.email || "").toLowerCase();

        // subscription items → take first one
        const item = sub.items.data[0];
        const priceId = item.price.id;

        const planInfo = PLAN_MAP[priceId];
        if (!planInfo) {
          console.log("Unknown priceId on subscription:", priceId);
          break;
        }

        // write to supabase
        await upsertUserPlan({
          email,
          plan_type: planInfo.plan_type,
          soft_cap: planInfo.soft_cap,
          // reset count on (re)subscribe
          reports_used: 0,
        });

        console.log(
          `✅ set plan for ${email} → ${planInfo.plan_type} (cap ${planInfo.soft_cap})`
        );
        break;
      }

      // 3. invoice.payment_succeeded → good moment to reset monthly usage
      case "invoice.payment_succeeded": {
        const invoice = stripeEvent.data.object;
        const customerId = invoice.customer;

        const customer = await stripe.customers.retrieve(customerId);
        const email = (customer.email || "").toLowerCase();

        // reset reports_used = 0 on billing cycle
        const { error } = await supabase
          .from("users")
          .update({ reports_used: 0 })
          .eq("email", email);

        if (error) {
          console.error("Supabase reset error:", error);
        } else {
          console.log(`🔁 reset monthly reports for ${email}`);
        }
        break;
      }

      // 4. usage-based overage (later, if we create usage records in Stripe)
      // we can listen for 'usage_record.summary.updated' etc.

      default: {
        // ignore other events
        break;
      }
    }

    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error("Webhook handler error:", err);
    return { statusCode: 500, body: "Server error" };
  }
}

// make sure the user row exists
async function ensureUserRow(email) {
  const lower = email.toLowerCase();

  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("email", lower)
    .maybeSingle();

  if (error) {
    console.error("ensureUserRow select error", error);
    return;
  }

  if (!data) {
    const { error: insertErr } = await supabase
      .from("users")
      .insert({
        email: lower,
        credits: 0, // legacy
        plan_type: "trial",
        soft_cap: 10,
        reports_used: 0,
      });

    if (insertErr) console.error("ensureUserRow insert error", insertErr);
  }
}

// insert or update user with plan
async function upsertUserPlan({ email, plan_type, soft_cap, reports_used = 0 }) {
  const lower = email.toLowerCase();

  // try update first
  const { data, error } = await supabase
    .from("users")
    .update({
      plan_type,
      soft_cap,
      reports_used,
    })
    .eq("email", lower)
    .select()
    .maybeSingle();

  if (error) {
    console.error("upsertUserPlan update error:", error);
  }

  if (!data) {
    // no row → insert
    const { error: insertErr } = await supabase.from("users").insert({
      email: lower,
      plan_type,
      soft_cap,
      reports_used,
    });
    if (insertErr) console.error("upsertUserPlan insert error:", insertErr);
  }
}
