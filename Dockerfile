# محاكي: صورة تشغيل واحدة (الواجهة + الخادم + موقع التسويق).
# البيانات (الحسابات والتقدم والسجلات والطلبات) في /data: اربطه بمساحة تخزين دائمة.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4173 \
    MOHAKI_DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY app ./app
COPY data ./data
COPY site ./site
COPY src ./src
COPY scripts/serve.js ./scripts/serve.js
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/serve.js"]
