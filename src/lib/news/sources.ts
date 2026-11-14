// News sources the crawler reads. Every entry was checked against the site's robots.txt
// and answered our honestly-labelled crawler (no browser disguise) with a fresh feed.

export type NewsSource = { id: string; name: string; url: string; homepage: string };

export const NEWS_SOURCES: NewsSource[] = [
  { id: "et-markets", name: "Economic Times", url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", homepage: "https://economictimes.indiatimes.com/markets" },
  { id: "et-stocks", name: "Economic Times", url: "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms", homepage: "https://economictimes.indiatimes.com/markets/stocks" },
  { id: "et-ipo", name: "Economic Times", url: "https://economictimes.indiatimes.com/markets/ipos/fpos/rssfeeds/14655708.cms", homepage: "https://economictimes.indiatimes.com/markets/ipos/fpos" },
  { id: "mint-markets", name: "LiveMint", url: "https://www.livemint.com/rss/markets", homepage: "https://www.livemint.com/market" },
  { id: "mint-companies", name: "LiveMint", url: "https://www.livemint.com/rss/companies", homepage: "https://www.livemint.com/companies" },
  { id: "hbl-markets", name: "BusinessLine", url: "https://www.thehindubusinessline.com/markets/feeder/default.rss", homepage: "https://www.thehindubusinessline.com/markets/" },
  { id: "hbl-stocks", name: "BusinessLine", url: "https://www.thehindubusinessline.com/markets/stock-markets/feeder/default.rss", homepage: "https://www.thehindubusinessline.com/markets/stock-markets/" },
  { id: "hindu-markets", name: "The Hindu", url: "https://www.thehindu.com/business/markets/feeder/default.rss", homepage: "https://www.thehindu.com/business/markets/" },
  { id: "cnbctv18", name: "CNBC-TV18", url: "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml", homepage: "https://www.cnbctv18.com/market/" },
  { id: "btoday", name: "Business Today", url: "https://www.businesstoday.in/rss/markets", homepage: "https://www.businesstoday.in/markets" },
];

/**
 * Checked on 14 Nov 2026 and left out on purpose. Shown on the news page so it's clear why.
 * Moneycontrol: RSS frozen since Apr 2024; its sitemap returns 403 to labelled crawlers; the
 * Google News route is disallowed by news.google.com/robots.txt.
 */
export const EXCLUDED_SOURCES: Array<{ name: string; reason: string }> = [
  { name: "Moneycontrol", reason: "RSS feeds stopped in Apr 2024; site blocks automated readers (HTTP 403)" },
  { name: "Business Standard", reason: "Blocks automated readers (HTTP 403)" },
  { name: "NDTV Profit", reason: "Blocks automated readers (HTTP 403)" },
  { name: "Zee Business", reason: "Blocks automated readers (HTTP 403)" },
  { name: "Google News", reason: "robots.txt disallows its RSS endpoints" },
];
