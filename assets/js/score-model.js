/* /assets/js/score-model.js */
window.IQWEB_SCORE_MODEL = {
  overallVerdict: function (score) {
    score = Number(score) || 0;
    if (score >= 90) return "Strong";
    if (score >= 70) return "Good";
    if (score >= 50) return "Fair";
    return "Poor";
  },

  signalHeadline: function (score, flagged, isPrimary, unmeasured) {
    score = Number(score);
    if (unmeasured) return "Not Measured";
    if (isPrimary) return "Priority Fix";
    if (flagged && score < 40) return "Critical Fix";
    if (flagged && score < 80) return "Secondary Fix";
    if (flagged) return "Improvement Opportunity";
    if (score >= 90) return "Strong";
    if (score >= 80) return "Stable";
    if (score < 40) return "Critical Fix";
    return "Needs Attention";
  },

  severityClass: function (score, unmeasured) {
    score = Number(score);
    if (unmeasured) return "severity-na";
    if (score < 40) return "severity-high";
    if (score < 90) return "severity-medium";
    return "severity-strong";
  }
};