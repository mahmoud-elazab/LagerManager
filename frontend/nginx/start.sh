#!/bin/sh
set -eu
export LC_ALL=C

# Accept a single HTTP origin with an explicit port, never arbitrary Nginx text.
case "${API_UPSTREAM:-}" in
    *[!A-Za-z0-9.:/-]*)
        echo 'API_UPSTREAM contains invalid characters.' >&2
        exit 1
        ;;
esac
if ! printf '%s\n' "${API_UPSTREAM:-}" | grep -Eq '^http://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*:[0-9]{1,5}$'; then
    echo 'API_UPSTREAM must be an HTTP hostname and port, such as http://backend:8080.' >&2
    exit 1
fi
port=${API_UPSTREAM##*:}
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo 'API_UPSTREAM has an invalid port.' >&2
    exit 1
fi
export API_UPSTREAM
API_UPSTREAM_HOSTPORT=${API_UPSTREAM#http://}
export API_UPSTREAM_HOSTPORT
envsubst '${API_UPSTREAM_HOSTPORT}' < /etc/nginx/lagermanager.conf.template > /tmp/lagermanager-server.conf
nginx -t
exec nginx -g 'daemon off;'
