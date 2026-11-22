// TLS material for a fake HomeWizard device: a CA standing in for
// HomeWizard's, and a device certificate it signed. Made fresh with openssl,
// so no private key is ever committed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestCertificates {
  /** The CA certificate, to trust in the client. */
  ca: string;
  /** The device's certificate and key, to serve. */
  cert: string;
  key: string;
}

export function makeTestCertificates({
  // Like a real device: named after the appliance, not its IP address.
  deviceName = "appliance/p1dongle/000000000000",
}: {
  deviceName?: string;
} = {}): TestCertificates {
  const dir = mkdtempSync(join(tmpdir(), "test-certificates-"));
  const file = (name: string) => join(dir, name);
  const openssl = (...args: string[]) =>
    execFileSync("openssl", args, { stdio: "pipe" });
  try {
    openssl(
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=Test Appliance Access CA",
      "-keyout",
      file("ca.key"),
      "-out",
      file("ca.crt")
    );
    openssl(
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      `/CN=${deviceName.replaceAll("/", "\\/")}`,
      "-keyout",
      file("device.key"),
      "-out",
      file("device.csr")
    );
    openssl(
      "x509",
      "-req",
      "-in",
      file("device.csr"),
      "-days",
      "2",
      "-CA",
      file("ca.crt"),
      "-CAkey",
      file("ca.key"),
      "-CAcreateserial",
      "-out",
      file("device.crt")
    );
    return {
      ca: readFileSync(file("ca.crt"), "utf8"),
      cert: readFileSync(file("device.crt"), "utf8"),
      key: readFileSync(file("device.key"), "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
