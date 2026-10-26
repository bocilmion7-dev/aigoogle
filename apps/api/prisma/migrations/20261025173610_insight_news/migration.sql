-- CreateTable
CREATE TABLE "NewsSource" (
    "id" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT NOT NULL DEFAULT '',
    "sourceName" TEXT NOT NULL DEFAULT '',
    "sourceDomain" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "topic" TEXT NOT NULL DEFAULT 'umum',
    "industries" TEXT NOT NULL DEFAULT '',
    "hash" TEXT NOT NULL,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantIndustry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "evidence" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantIndustry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsDigest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsAskLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsAskLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsSource_query_key" ON "NewsSource"("query");

-- CreateIndex
CREATE INDEX "NewsSource_industry_idx" ON "NewsSource"("industry");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_url_key" ON "NewsItem"("url");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_hash_key" ON "NewsItem"("hash");

-- CreateIndex
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");

-- CreateIndex
CREATE INDEX "NewsItem_topic_idx" ON "NewsItem"("topic");

-- CreateIndex
CREATE INDEX "TenantIndustry_tenantId_idx" ON "TenantIndustry"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantIndustry_tenantId_industry_key" ON "TenantIndustry"("tenantId", "industry");

-- CreateIndex
CREATE INDEX "NewsDigest_tenantId_date_idx" ON "NewsDigest"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "NewsDigest_tenantId_date_key" ON "NewsDigest"("tenantId", "date");

-- CreateIndex
CREATE INDEX "NewsAskLog_tenantId_createdAt_idx" ON "NewsAskLog"("tenantId", "createdAt");
