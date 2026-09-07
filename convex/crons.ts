import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Every 30 minutes re-scrape the sources of every open case. The sweep skips
 * sources scraped in the last 25 minutes and Firecrawl's maxAge cache means a
 * repeat scrape of an unchanged page costs no credits.
 */
const crons = cronJobs();

crons.interval("re-scan shelter pages for open cases", { hours: 6 }, internal.crawl.sweep, {});

export default crons;
