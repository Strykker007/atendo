# Imagem do backup: cliente do Postgres 16 + rclone, nada mais.
FROM alpine:3.20
RUN apk add --no-cache postgresql16-client rclone tzdata
COPY backup.sh restore.sh agenda.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/agenda.sh
ENV TZ=America/Sao_Paulo
# laço simples em vez de cron: um processo só, log direto no docker logs
CMD ["sh", "/usr/local/bin/agenda.sh"]
