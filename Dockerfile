FROM nginx:stable-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949

# Apply fixed Alpine packages until the upstream image includes these security updates.
RUN apk add --no-cache --upgrade brotli-libs=1.2.1-r0 curl=8.23.0-r0 libcurl=8.23.0-r0

# Package an existing release without rebuilding or mounting the workspace.
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY dist/ /usr/share/nginx/html/

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/index.html || exit 1

ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
