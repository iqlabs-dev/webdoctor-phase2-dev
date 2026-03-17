function getPlatformPolicy(platform) {
  const key = platform?.key || "unknown";

  // Default = full control (strict scoring)
  let controlLevel = "full";

  if ([
    "webflow",
    "shopify",
    "wix",
    "squarespace",
    "framer",
    "carrd",
  ].includes(key)) {
    controlLevel = "limited";
  }

  if ([
    "wordpress",
    "ghost",
    "hubspot",
    "duda",
    "bubble",
  ].includes(key)) {
    controlLevel = "partial";
  }

  return {
    controlLevel,

    // How much to reduce penalties
    penaltyMultiplier:
      controlLevel === "limited" ? 0.3 :
      controlLevel === "partial" ? 0.6 :
      1,

    // Messaging tone
    messaging:
      controlLevel === "limited"
        ? "platform_managed"
        : controlLevel === "partial"
        ? "partially_managed"
        : "fully_controllable",
  };
}

module.exports = { getPlatformPolicy };