// /utils/platfrm-policy.js

const PLATFORM_POLICIES = {
  webflow: {
    controlLevel: "limited",
    securityManaged: true,
    scoreFloor: 95,
    penaltyMultiplier: 0,
    messaging: "platform_managed"
  },

  shopify: {
    controlLevel: "limited",
    securityManaged: true,
    scoreFloor: 95,
    penaltyMultiplier: 0,
    messaging: "platform_managed"
  },

  wix: {
    controlLevel: "limited",
    securityManaged: true,
    scoreFloor: 95,
    penaltyMultiplier: 0,
    messaging: "platform_managed"
  },

  squarespace: {
    controlLevel: "limited",
    securityManaged: true,
    scoreFloor: 95,
    penaltyMultiplier: 0,
    messaging: "platform_managed"
  },

  framer: {
    controlLevel: "limited",
    securityManaged: true,
    scoreFloor: 95,
    penaltyMultiplier: 0,
    messaging: "platform_managed"
  },

  wordpress: {
    controlLevel: "full",
    securityManaged: false,
    scoreFloor: null,
    penaltyMultiplier: 1,
    messaging: "direct"
  },

  ghost: {
    controlLevel: "full",
    securityManaged: false,
    scoreFloor: null,
    penaltyMultiplier: 1,
    messaging: "direct"
  },

  unknown: {
    controlLevel: "full",
    securityManaged: false,
    scoreFloor: null,
    penaltyMultiplier: 1,
    messaging: "direct"
  }
};

function getPlatformPolicy(platformKey) {
  return (
    PLATFORM_POLICIES[String(platformKey || "").toLowerCase()] ||
    PLATFORM_POLICIES.unknown
  );
}

module.exports = { getPlatformPolicy };