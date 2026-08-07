import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("generate_review.py")


def load_module():
    spec = importlib.util.spec_from_file_location("generate_review_under_test", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GenerateReviewPortSafetyTests(unittest.TestCase):
    def test_port_number_is_strictly_validated(self):
        module = load_module()

        self.assertEqual(module.port_number("0"), 0)
        self.assertEqual(module.port_number("3117"), 3117)
        self.assertEqual(module.port_number("65535"), 65535)
        for value in ("-1", "65536", "not-a-port"):
            with self.subTest(value=value), self.assertRaises(module.argparse.ArgumentTypeError):
                module.port_number(value)

    def test_busy_port_falls_back_without_process_kill(self):
        module = load_module()
        requested_port = 3117
        attempted_ports = []

        class FakeServer:
            def __init__(self, address, handler):
                del handler
                attempted_ports.append(address[1])
                if address[1] == requested_port:
                    raise OSError("port is busy")
                self.server_address = (address[0], 43210)

            def serve_forever(self):
                raise KeyboardInterrupt

            def server_close(self):
                pass

        with tempfile.TemporaryDirectory() as workspace_dir:
            (Path(workspace_dir) / "run" / "outputs").mkdir(parents=True)
            (Path(workspace_dir) / "run" / "outputs" / "result.txt").write_text("ok")
            argv = [str(MODULE_PATH), workspace_dir, "--port", str(requested_port)]
            with (
                mock.patch.object(module, "HTTPServer", FakeServer),
                mock.patch.object(module.webbrowser, "open"),
                mock.patch.object(
                    subprocess,
                    "run",
                    side_effect=AssertionError("process inspection must not run"),
                ),
                mock.patch.object(sys, "argv", argv),
            ):
                module.main()

        self.assertEqual(attempted_ports, [requested_port, 0])


if __name__ == "__main__":
    unittest.main()
