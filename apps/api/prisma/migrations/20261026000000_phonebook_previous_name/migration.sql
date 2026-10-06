-- Nome anterior da agenda (docs/04-providers-whatsapp.md › De onde vem o nome do contato).
-- A Evolution guarda UM nome por contato e o troca pelo nome de perfil do WhatsApp; se essa
-- troca chegar como se fosse agenda, a próxima mensagem com esse pushName restaura o anterior.
ALTER TABLE "phonebook_entries" ADD COLUMN "previousName" TEXT;
