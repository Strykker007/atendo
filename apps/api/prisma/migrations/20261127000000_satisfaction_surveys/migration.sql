-- Pesquisa de satisfação no encerramento (docs/pesquisa-de-satisfacao.md)
CREATE TYPE "SurveyResponseStatus" AS ENUM ('pending', 'commenting', 'answered', 'declined', 'expired', 'failed');

CREATE TABLE "satisfaction_surveys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scale" TEXT NOT NULL DEFAULT 'scale_5',
    "question" TEXT NOT NULL,
    "allowDecline" BOOLEAN NOT NULL DEFAULT true,
    "declineLabel" TEXT NOT NULL DEFAULT 'Não responder',
    "askComment" BOOLEAN NOT NULL DEFAULT true,
    "commentPrompt" TEXT,
    "thanksMessage" TEXT,
    "declinedMessage" TEXT,
    "expiresHours" INTEGER NOT NULL DEFAULT 24,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "satisfaction_surveys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "satisfaction_surveys_tenantId_idx" ON "satisfaction_surveys"("tenantId");
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "agentId" TEXT,
    "agentName" TEXT,
    "scale" TEXT NOT NULL,
    "status" "SurveyResponseStatus" NOT NULL DEFAULT 'pending',
    "score" INTEGER,
    "comment" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "survey_responses_tenantId_sentAt_idx" ON "survey_responses"("tenantId", "sentAt");
CREATE INDEX "survey_responses_tenantId_agentId_sentAt_idx" ON "survey_responses"("tenantId", "agentId", "sentAt");
CREATE INDEX "survey_responses_conversationId_status_idx" ON "survey_responses"("conversationId", "status");
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "satisfaction_surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
