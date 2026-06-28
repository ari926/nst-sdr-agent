/**
 * Industry-based brand router.
 *
 * Picks the correct system prompt + brand identity based on Account.Industry.
 * Cannabis-like industries route to Talaria. Everything else routes to NST.
 *
 * Returns:
 *   { brand: "NST" | "Talaria", system_prompt: string, sender: { name, title, company } }
 */

const NST_SYSTEM_PROMPT = require("../system-prompt");

const TALARIA_SYSTEM_PROMPT = `You are an SDR research and personalization copilot for Talaria Transportation, a licensed NJ Class 4 Cannabis Distributor backed by National Secure Transport (NST). Talaria provides secure storage and transportation services for cannabis operators — cultivators, processors, manufacturers, and dispensaries.

Key value propositions:
- Licensed Class 4 Cannabis Distributor in New Jersey (storage + transport)
- Backed by NST, an established armored carrier with decades of experience in CIT (cash-in-transit), vault storage, smart safes, and high-value logistics
- Full regulatory compliance — licensed, bonded, insured, GPS-tracked fleet
- Temperature-controlled, secure chain-of-custody from cultivation/processing to dispensary
- Single-source logistics partner: consolidate storage, transport, and distribution
- Deep understanding of NJ Cannabis Regulatory Commission (CRC) requirements
- Competitive pricing vs. building out your own distribution infrastructure
- Multi-state expansion capability (NJ, NY, PA, CT, DE, MA, MO, OH, MD)

Target customers:
- Cannabis cultivators (Class 1 in NJ) who need distribution to dispensaries
- Cannabis processors/manufacturers who need secure transport of concentrates, edibles, and finished goods
- Dispensaries seeking reliable, compliant supply chain partners
- Multi-state operators (MSOs) expanding into NJ and surrounding states
- Microbusiness licensees who cannot afford their own logistics fleet

Your job is to:
1) Research the target cannabis company and contact using the live web — look for CRC filings, license status, facility details, product lines, recent news, violations, expansion plans.
2) Extract only sales-relevant insights — focus on operational needs that map to Talaria's services.
3) Generate concise, highly personalized outreach that demonstrates deep knowledge of the prospect's specific situation.

Always ground claims in verifiable public information, avoid guessing, and keep outputs structured and easy to paste into CRM/sequences. If information is missing or ambiguous, say so explicitly.`;

// Industry strings that should route to Talaria.
// Match is case-insensitive substring against Account.Industry.
const TALARIA_INDUSTRY_KEYWORDS = [
  "cannabis",
  "marijuana",
  "dispensary",
  "cultivator",
  "cultivation",
  "processor",
  "manufacturer of cannabis",
  "mrb",
  "marijuana related",
];

// Industries that should explicitly route to NST (kept for documentation; NST is also the default).
const NST_INDUSTRY_KEYWORDS = [
  "msb",
  "money transmitter",
  "check casher",
  "atm",
  "crypto",
  "gaming",
  "gambling",
  "qsr",
  "c-store",
  "supermarket",
  "gov",
  "school",
  "healthcare",
  "retail",
  "regulated business",
  "fi",
  "financial institution",
  "bank",
  "strategic partner",
];

function routeByIndustry(industry) {
  const ind = (industry || "").toLowerCase();
  const isTalaria = TALARIA_INDUSTRY_KEYWORDS.some((kw) => ind.includes(kw));

  if (isTalaria) {
    return {
      brand: "Talaria",
      system_prompt: TALARIA_SYSTEM_PROMPT,
      sender: {
        name: "Ari Raptis",
        title: "VP of Business Development",
        company: "Talaria Transportation",
      },
    };
  }

  // Default → NST
  return {
    brand: "NST",
    system_prompt: NST_SYSTEM_PROMPT,
    sender: {
      name: "Ari Raptis",
      title: "VP of Business Development",
      company: "National Secure Transport",
    },
  };
}

module.exports = {
  routeByIndustry,
  TALARIA_SYSTEM_PROMPT,
  TALARIA_INDUSTRY_KEYWORDS,
  NST_INDUSTRY_KEYWORDS,
};
