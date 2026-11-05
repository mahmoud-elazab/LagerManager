#!/usr/bin/env python3
"""Local, disposable Nginx -> Spring Boot -> MySQL smoke test. No third-party packages."""
import argparse
import base64
from datetime import datetime
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request

ROOT = Path(__file__).resolve().parents[1]
OWNER = "com.lagermanager.smoke"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.paths.append(attrs["src"])
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.paths.append(attrs["href"])


class Smoke:
    def __init__(self, directory):
        self.project = "lm-smoke-" + secrets.token_hex(8)
        self.directory = Path(directory)
        self.volume = self.project + "_mysql-data"
        self.images = [f"lagermanager-{service}:{self.project}" for service in ("backend", "frontend")]
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("COMPOSE_")}
        self.env.update(MYSQL_APP_PASSWORD=secrets.token_hex(24), MYSQL_ROOT_PASSWORD=secrets.token_hex(24),
                        LAGERMANAGER_JWT_SECRET=base64.b64encode(secrets.token_bytes(32)).decode())
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            self.port = reservation.getsockname()[1]
        require(self.port != 8082, "Refusing normal stack port")
        self.env["FRONTEND_PORT"] = str(self.port)
        self.env_file = self.directory / "empty.env"
        self.env_file.touch(mode=0o600)
        self.config = self.directory / "compose.json"
        self.armed = False
        self.docker_target = []
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def docker(self, *args, allowed=(0,), timeout=600):
        result = subprocess.run(["docker", *self.docker_target, *args], cwd=ROOT, env=self.env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        # Do not expose Docker output: config/errors can contain generated runtime secrets.
        require(result.returncode in allowed, f"Docker {args[0]} failed (exit {result.returncode}); output suppressed to protect credentials")
        return result.stdout.decode().strip()

    def compose(self, *args, **kwargs):
        return self.docker("compose", "--project-name", self.project, "--env-file", str(self.env_file),
                           "-f", str(self.config), *args, **kwargs)

    def resources(self, kind):
        command = {"container": ("ps", "-aq"), "volume": ("volume", "ls", "-q"),
                   "network": ("network", "ls", "-q")}[kind]
        return self.docker(*command, "--filter", f"label=com.docker.compose.project={self.project}").splitlines()

    def normal_snapshot(self):
        ids = self.docker("ps", "-aq", "--filter", "label=com.docker.compose.project=lagermanager").splitlines()
        containers = [self.docker("inspect", "--format",
                      '{{.Id}} {{.Image}} {{.State.Running}} {{.State.StartedAt}}', item) for item in sorted(ids)]
        images = [self.docker("image", "inspect", "--format", "{{.Id}}", ref, allowed=(0, 1))
                  for ref in ("lagermanager-backend:local", "lagermanager-frontend:local")]
        volume = self.docker("volume", "inspect", "--format", "{{.Name}} {{.CreatedAt}}",
                             "lagermanager_mysql-data", allowed=(0, 1))
        return containers, images, volume

    def prepare(self):
        # Context metadata inspection is local and never contacts the selected daemon.
        context = self.env.get("DOCKER_CONTEXT")
        if context:
            endpoint = json.loads(self.docker("context", "inspect", context,
                                             "--format", "{{json .Endpoints.docker.Host}}"))
        else:
            endpoint = self.env.get("DOCKER_HOST") or json.loads(self.docker(
                "context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"))
        require(endpoint.startswith(("unix://", "npipe://")), "Use a local Docker daemon")
        # Pin every subsequent command (including Compose and cleanup) to this endpoint.
        self.env.pop("DOCKER_CONTEXT", None)
        self.env.pop("DOCKER_HOST", None)
        self.docker_target = ["--host", endpoint]
        self.docker("info", "--format", "{{.ServerVersion}}")
        self.before = self.normal_snapshot()
        for kind in ("container", "volume", "network"):
            require(not self.resources(kind), f"Project already has {kind} resources")
        require(not self.docker("volume", "ls", "-q", "--filter", f"name=^{self.volume}$"), "Volume already exists")
        for name in (self.project + "_application", self.project + "_ingress"):
            require(not self.docker("network", "ls", "-q", "--filter", f"name=^{name}$"), "Network already exists")
        for image in self.images:
            require(not self.docker("image", "ls", "-q", image), "Image tag already exists")
        override = self.directory / "override.json"
        override.write_text(json.dumps({
            "services": {service: {"image": image, "labels": {OWNER: self.project}}
                         for service, image in zip(("backend", "frontend"), self.images)} | {
                             "mysql": {"labels": {OWNER: self.project}}},
            "volumes": {"mysql-data": {"labels": {OWNER: self.project}}},
            "networks": {name: {"labels": {OWNER: self.project}} for name in ("application", "ingress")},
        }))
        resolved = json.loads(self.docker("compose", "--project-name", self.project, "--env-file", str(self.env_file),
                                         "-f", str(ROOT / "compose.yaml"), "-f", str(override), "config", "--format", "json"))
        services = resolved["services"]
        require(resolved["name"] == self.project and set(services) == {"mysql", "backend", "frontend"}, "Unexpected project/services")
        require(set(resolved["volumes"]) == {"mysql-data"}, "Unexpected volumes")
        volume = resolved["volumes"]["mysql-data"]
        require(volume["name"] == self.volume and not volume.get("external") and not volume.get("driver_opts"), "Unsafe volume")
        require(set(resolved["networks"]) == {"application", "ingress"}, "Unexpected networks")
        for name, network in resolved["networks"].items():
            require(network["name"] == self.project + "_" + name and not network.get("external"), "Unsafe network")
        require(resolved["networks"]["application"].get("internal"), "Database network must remain internal")
        for service, spec in services.items():
            require(not any(spec.get(key) for key in ("container_name", "privileged", "network_mode", "volumes_from", "secrets", "configs")), "Unsafe service settings")
            require(spec.get("labels", {}).get(OWNER) == self.project, "Missing ownership label")
            mounts = spec.get("volumes", [])
            if service == "mysql":
                require(len(mounts) == 1 and mounts[0]["type"] == "volume"
                        and mounts[0]["source"] == "mysql-data" and mounts[0]["target"] == "/var/lib/mysql", "Unsafe MySQL mount")
                require(spec["image"] == "mysql:9.7.2", "Unexpected MySQL image")
            else:
                require(not mounts and spec["image"] == self.images[("backend", "frontend").index(service)], "Unsafe application image/mount")
                expected_context = ROOT if service == "backend" else ROOT / "frontend"
                require(Path(spec["build"]["context"]).resolve() == expected_context, "Unexpected build context")
            ports = spec.get("ports", [])
            if service == "frontend":
                require(len(ports) == 1 and ports[0].get("host_ip") == "127.0.0.1"
                        and int(ports[0]["published"]) == self.port and ports[0]["target"] == 8080, "Unsafe published port")
            else:
                require(not ports, "Backend/MySQL must not publish ports")
        backend_env = services["backend"]["environment"]
        require(backend_env["SPRING_DATASOURCE_URL"] == "jdbc:mysql://mysql:3306/lagermanager?allowPublicKeyRetrieval=true&useSSL=false", "Unsafe datasource")
        require(all(str(backend_env[key]).lower() == "false" for key in
                    ("LAGERMANAGER_LOCAL_DEMO_POPULATE", "LAGERMANAGER_DEMO_RESET_PASSWORDS")), "Seeding must be disabled")
        # Freeze the validated configuration; never load the private project .env.
        self.config.touch(mode=0o600)
        self.config.write_text(json.dumps(resolved))
        self.armed = True
        print(f"PASS isolation: project={self.project}, loopback port={self.port}, fresh volume and unique image tags", flush=True)

    def http(self, method, path, expected=200, body=None, token=None, raw=False):
        require(path.startswith("/") and not path.startswith("//"), "Only local paths allowed")
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = Request(f"http://127.0.0.1:{self.port}{path}",
                          data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            data = response.read()
            require(response.status == expected, f"{method} {path}: expected {expected}, got {response.status}")
            if raw:
                return data, response.headers.get_content_type()
            if not data:
                return None
            require(response.headers.get_content_type() == "application/json", f"{path}: expected JSON")
            return json.loads(data)

    def ready(self):
        # Only reads may retry while Nginx refreshes the backend address after recreation.
        for _ in range(30):
            try:
                self.http("GET", "/api/products", 401)
                return
            except (RuntimeError, URLError, TimeoutError):
                time.sleep(1)
        raise RuntimeError("Nginx -> backend did not become ready")

    def login(self, email, password, role):
        result = self.http("POST", "/api/auth/login", body={"email": email, "password": password})
        require(result.get("tokenType") == "Bearer" and isinstance(result.get("token"), str) and result["token"], "Invalid login response")
        token = result["token"]
        require(self.http("GET", "/api/auth/me", token=token) == {"email": email, "role": role}, "Role confirmation failed")
        return token

    def container_ids(self):
        ids = set(self.compose("ps", "-q").splitlines())
        require(len(ids) == 3, "Expected three test containers")
        return ids

    def volume_identity(self):
        identity = self.docker("volume", "inspect", "--format", '{{.Name}} {{.CreatedAt}}', self.volume)
        owner = self.docker("volume", "inspect", "--format", '{{index .Labels "com.lagermanager.smoke"}}', self.volume)
        require(owner == self.project, "Test volume ownership mismatch")
        return identity

    def run(self, fail_after_start):
        print("Building unique test image tags and starting the isolated stack…", flush=True)
        self.compose("build", timeout=900)
        self.compose("up", "-d", "--wait", "--wait-timeout", "240", timeout=300)
        self.ready()
        if fail_after_start:
            raise RuntimeError("Intentional failure after startup (cleanup verification)")
        html, content_type = self.http("GET", "/", raw=True)
        require(content_type == "text/html" and b'<div id="root"></div>' in html and b"LagerManager" in html, "Missing sign-in SPA shell")
        assets = Assets()
        assets.feed(html.decode())
        require(any(p.endswith(".js") for p in assets.paths) and any(p.endswith(".css") for p in assets.paths), "Missing built JS/CSS links")
        for path in assets.paths:
            require(path.startswith("/assets/"), "Unexpected built asset path")
            content, kind = self.http("GET", path, raw=True)
            require(content and kind != "text/html", "Asset returned empty content or SPA fallback")
            if path.endswith(".js"):
                require(kind in ("application/javascript", "text/javascript") and b"Sign in" in content, "Missing sign-in client bundle")
            if path.endswith(".css"):
                require(kind == "text/css", "Invalid CSS content type")
        self.http("GET", "/api/products", 401)
        print("PASS frontend HTML, built JS/CSS and protected-endpoint 401 through Nginx", flush=True)
        accounts = {}
        for role in ("EMPLOYEE", "ADMIN"):
            email, password = f"{role.lower()}-{self.project}@example.test", secrets.token_urlsafe(24)
            require(self.http("POST", "/api/auth/register", 201, {"email": email, "password": password, "role": role}) == {"email": email}, "Registration response mismatch")
            accounts[role] = (email, password, self.login(email, password, role))
        employee, admin = accounts["EMPLOYEE"][2], accounts["ADMIN"][2]
        require(self.http("GET", "/api/products", token=admin) == [], "Test database is not fresh")
        product = self.http("POST", "/api/products", body={"name": "Smoke bolts", "sku": self.project, "price": 12.50}, token=admin)
        deletion = self.http("POST", "/api/products", body={"name": "Smoke delete target", "sku": self.project + "-delete", "price": 1}, token=admin)
        deletion_path = f'/api/products/{deletion["id"]}'
        self.http("DELETE", deletion_path, 403, token=employee)
        require(self.http("GET", deletion_path, token=admin)["id"] == deletion["id"], "Forbidden DELETE changed record")
        self.http("DELETE", deletion_path, token=admin)
        require(all(p["id"] != deletion["id"] for p in self.http("GET", "/api/products", token=admin)), "Admin DELETE did not remove record")
        print("PASS Employee/Admin registration, login, /me; same DELETE is 403/200 with verified effects", flush=True)
        warehouse = self.http("POST", "/api/warehouses", body={"name": "Smoke depot", "location": "Disposable", "capacity": 100}, token=admin)
        inventory = self.http("POST", "/api/inventory", body={"productId": product["id"], "warehouseId": warehouse["id"], "quantity": 0}, token=admin)
        path = f'/api/inventory/{inventory["id"]}'
        require(inventory["quantity"] == 0 and self.http("GET", path + "/movements", token=employee) == [], "Expected zero opening balance/history")
        updated = self.http("POST", path + "/movements", body={"type": "RECEIVE", "quantity": 7, "reason": "Smoke delivery"}, token=employee)
        require(updated["quantity"] == 7, "Movement response quantity mismatch")
        history = self.http("GET", path + "/movements", token=employee)
        require(len(history) == 1, "Expected one movement")
        row = history[0]
        expected = {"inventoryId": inventory["id"], "type": "RECEIVE", "quantityChange": 7,
                    "previousQuantity": 0, "resultingQuantity": 7, "actor": accounts["EMPLOYEE"][0], "reason": "Smoke delivery"}
        require(all(row.get(k) == v for k, v in expected.items()) and row.get("id", 0) > 0, "Movement history mismatch")
        datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
        require(self.http("GET", path, token=employee)["quantity"] == 7, "Stored quantity mismatch")
        require(self.http("GET", f'/api/products/{product["id"]}', token=employee)["totalStock"] == 7, "Derived total mismatch")
        old_ids, volume = self.container_ids(), self.volume_identity()
        print("PASS Employee stock receipt, stored quantity, derived total and actor-attributed history", flush=True)
        self.compose("down", "--timeout", "20")  # Retain the test volume deliberately.
        require(not self.resources("container") and self.volume_identity() == volume, "Volume not retained across down")
        self.compose("up", "-d", "--wait", "--wait-timeout", "240", timeout=300)
        self.ready()
        require(old_ids.isdisjoint(self.container_ids()) and self.volume_identity() == volume, "Containers not recreated or volume replaced")
        for role, (email, password, _) in accounts.items():
            accounts[role] = (email, password, self.login(email, password, role))
        token = accounts["EMPLOYEE"][2]
        require(self.http("GET", path, token=token)["quantity"] == 7, "Quantity did not persist")
        require(self.http("GET", path + "/movements", token=token) == history, "Exact history did not persist")
        require(self.http("GET", f'/api/products/{product["id"]}', token=token)["totalStock"] == 7, "Total did not persist")
        print("PASS all containers recreated; same volume, accounts, quantity and exact history persisted", flush=True)

    def cleanup(self):
        errors = []

        def attempt(action):
            try:
                action()
            except Exception as error:
                errors.append(str(error) if isinstance(error, RuntimeError) else type(error).__name__)

        if self.armed:
            attempt(lambda: self.compose("down", "--volumes", "--remove-orphans", "--timeout", "20", timeout=120))
            for image in self.images:
                def remove_tag(image=image):
                    if self.docker("image", "ls", "-q", image):
                        self.docker("image", "rm", image)  # Only this run's tag; never force/prune.
                attempt(remove_tag)
            for kind in ("container", "volume", "network"):
                attempt(lambda kind=kind: require(not self.resources(kind), f"Cleanup left test {kind} resources"))
            attempt(lambda: require(not self.docker("volume", "ls", "-q", "--filter", f"name=^{self.volume}$"), "Test volume remains"))
            attempt(lambda: require(all(not self.docker("image", "ls", "-q", image) for image in self.images), "Test image tag remains"))
            if not errors:
                print("PASS cleanup: test containers, networks, volume and unique image tags removed", flush=True)
        if hasattr(self, "before"):
            def verify_normal():
                require(self.normal_snapshot() == self.before, "Normal stack container/image/volume identity changed during run")
                print("PASS normal stack container/start/image/volume identities unchanged", flush=True)
            attempt(verify_normal)
        require(not errors, "; ".join(errors))


def interrupted(signum, frame):
    raise RuntimeError(f"Interrupted by signal {signum}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fail-after-start", action="store_true", help="Intentionally fail after healthy startup to verify failure cleanup (exit 1)")
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    success = True
    with tempfile.TemporaryDirectory(prefix="lm-compose-smoke-") as directory:
        smoke = Smoke(directory)
        try:
            smoke.prepare()
            smoke.run(args.fail_after_start)
        except Exception as error:
            success = False
            # HTTP/JSON errors are deliberately not dumped with credential-bearing bodies.
            print(f"FAIL: {error if isinstance(error, RuntimeError) else type(error).__name__}", file=sys.stderr, flush=True)
        finally:
            # Allow cleanup to finish if a second interrupt arrives.
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            try:
                smoke.cleanup()
            except Exception as error:
                success = False
                print(f"FAIL cleanup for {smoke.project}: {error if isinstance(error, RuntimeError) else type(error).__name__}", file=sys.stderr, flush=True)
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
