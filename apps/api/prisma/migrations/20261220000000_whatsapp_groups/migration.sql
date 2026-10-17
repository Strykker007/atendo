-- Grupos restritos (docs/grupos.md): lista branca de grupos por número + alvos de grupo na transmissão
CREATE TABLE "whatsapp_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "authorized" BOOLEAN NOT NULL DEFAULT false,
    "authorizedAt" TIMESTAMP(3),
    "authorizedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "whatsapp_groups_numberId_jid_key" ON "whatsapp_groups"("numberId", "jid");
CREATE INDEX "whatsapp_groups_tenantId_authorized_idx" ON "whatsapp_groups"("tenantId", "authorized");
ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "whatsapp_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "campaign_group_targets" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "status" "CampaignTargetStatus" NOT NULL DEFAULT 'pending',
    "externalId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "campaign_group_targets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "campaign_group_targets_campaignId_groupId_key" ON "campaign_group_targets"("campaignId", "groupId");
CREATE INDEX "campaign_group_targets_campaignId_status_idx" ON "campaign_group_targets"("campaignId", "status");
ALTER TABLE "campaign_group_targets" ADD CONSTRAINT "campaign_group_targets_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_group_targets" ADD CONSTRAINT "campaign_group_targets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "whatsapp_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
