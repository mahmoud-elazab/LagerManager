"""Docker target regression checks; subprocesses and socket allocation are mocked."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("compose_smoke", Path(__file__).with_name("compose-smoke.py"))
smoke_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke_module)


class DockerTargetTests(unittest.TestCase):
    def runner(self, directory, environment):
        with patch.dict(smoke_module.os.environ, environment, clear=True), patch.object(smoke_module.socket, "socket") as socket:
            socket.return_value.__enter__.return_value.getsockname.return_value = ("127.0.0.1", 54321)
            return smoke_module.Smoke(directory)

    def test_remote_context_overrides_local_host_without_daemon_contact(self):
        with tempfile.TemporaryDirectory() as directory:
            smoke = self.runner(directory, {"DOCKER_HOST": "unix:///local.sock", "DOCKER_CONTEXT": "remote-test"})
            with patch.object(smoke_module.subprocess, "run") as run:
                run.return_value = subprocess.CompletedProcess([], 0, json.dumps("ssh://remote.invalid").encode(), b"")
                with self.assertRaisesRegex(RuntimeError, "Use a local Docker daemon"):
                    smoke.prepare()
                smoke.cleanup()
                self.assertEqual(run.call_count, 1)
                self.assertEqual(run.call_args.args[0], ["docker", "context", "inspect", "remote-test",
                                                       "--format", "{{json .Endpoints.docker.Host}}"])
                self.assertFalse(smoke.armed)

    def test_remote_host_rejected_without_any_docker_command(self):
        with tempfile.TemporaryDirectory() as directory:
            smoke = self.runner(directory, {"DOCKER_HOST": "tcp://remote.invalid:2376"})
            with patch.object(smoke_module.subprocess, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "Use a local Docker daemon"):
                    smoke.prepare()
                smoke.cleanup()
                run.assert_not_called()

    def test_local_targets_are_pinned_for_commands_and_cleanup(self):
        cases = [
            ({"DOCKER_HOST": "unix:///host.sock"}, None, "unix:///host.sock"),
            ({"DOCKER_HOST": "tcp://ignored.invalid:2376", "DOCKER_CONTEXT": "local-test"}, "local-test", "unix:///context.sock"),
            ({}, "", "unix:///current.sock"),
        ]
        for environment, context, endpoint in cases:
            with self.subTest(environment=environment), tempfile.TemporaryDirectory() as directory:
                smoke = self.runner(directory, environment)

                def response(command, **kwargs):
                    if command[1:3] == ["context", "inspect"]:
                        return subprocess.CompletedProcess(command, 0, json.dumps(endpoint).encode(), b"")
                    # Stop prepare before any resource checks/build/start; the target is already pinned.
                    if command[-3:] == ["info", "--format", "{{.ServerVersion}}"]:
                        raise RuntimeError("stop at first daemon command")
                    return subprocess.CompletedProcess(command, 0, b"", b"")

                with patch.object(smoke_module.subprocess, "run", side_effect=response) as run:
                    with self.assertRaisesRegex(RuntimeError, "stop at first daemon command"):
                        smoke.prepare()
                    if context is not None:
                        expected = ["docker", "context", "inspect"] + ([context] if context else [])
                        self.assertEqual(run.call_args_list[0].args[0][:-2], expected)
                    self.assertEqual(smoke.docker_target, ["--host", endpoint])
                    self.assertNotIn("DOCKER_CONTEXT", smoke.env)
                    self.assertNotIn("DOCKER_HOST", smoke.env)
                    # Simulate an armed failed run; all teardown/resource checks must use the same endpoint.
                    smoke.armed = True
                    smoke.compose("up", "-d")
                    smoke.cleanup()
                    calls = [call.args[0] for call in run.call_args_list]
                    daemon_calls = calls[1:] if context is not None else calls
                    self.assertTrue(daemon_calls)
                    self.assertTrue(all(command[:3] == ["docker", "--host", endpoint] for command in daemon_calls))
                    self.assertTrue(any("down" in command and "--volumes" in command for command in daemon_calls))


if __name__ == "__main__":
    unittest.main()
