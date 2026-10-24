FROM docker.n8n.io/n8nio/n8n:2.43.8
USER root
COPY --chown=node:node credential-importer.mjs server.mjs start.sh /opt/customerlead/
RUN chmod 755 /opt/customerlead/start.sh
USER node
EXPOSE 8080
ENTRYPOINT ["tini", "--", "/bin/sh", "/opt/customerlead/start.sh"]
