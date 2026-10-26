import { describe, expect, it } from "vitest";
import { isAllowedDomain, parseGoogleNews, titleHash } from "../src/wawasan/sources.js";

const XML = `<?xml version="1.0"?><rss><channel>
<item>
  <title>Harga cabai naik - Kontan</title>
  <link>https://news.google.com/rss/articles/AAA</link>
  <pubDate>Sun, 25 Oct 2026 07:00:00 GMT</pubDate>
  <description><![CDATA[<a href="x">Harga cabai naik 22%</a>]]></description>
  <source url="https://www.kontan.co.id">Kontan</source>
</item>
<item>
  <title>Berita blog tidak terverifikasi</title>
  <link>https://news.google.com/rss/articles/BBB</link>
  <pubDate>Sun, 25 Oct 2026 07:00:00 GMT</pubDate>
  <description>blog</description>
  <source url="https://blog-random.example">Blog Random</source>
</item>
</channel></rss>`;

describe("ingest berita", () => {
  it("hanya domain whitelist yang lolos, snippet bersih", () => {
    const rows = parseGoogleNews(XML);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceName).toBe("Kontan");
    expect(rows[0]!.sourceDomain).toBe("kontan.co.id");
    expect(rows[0]!.snippet).toContain("Harga cabai naik 22%");
    expect(rows[0]!.snippet).not.toContain("<a");
  });

  it("whitelist domain resmi & media", () => {
    expect(isAllowedDomain("kemenkeu.go.id")).toBe(true);
    expect(isAllowedDomain("www.kontan.co.id")).toBe(true);
    expect(isAllowedDomain("blog-random.example")).toBe(false);
  });

  it("hash judul mengabaikan akhiran media", () => {
    expect(titleHash("Harga cabai naik - Kontan")).toBe(titleHash("Harga Cabai Naik"));
  });
});
