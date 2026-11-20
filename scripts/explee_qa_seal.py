#!/usr/bin/env python3
"""Seal an OpenOutFind QA report to a one-off analyst public key.

Only ciphertext is uploaded. The corresponding RSA private key is never put
in source, GitHub secrets, workflow logs, or Actions artifacts.
"""
from __future__ import annotations
import base64
import json
import os
import sys
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.serialization import load_der_public_key

PUBLIC_KEY_DER_BASE64 = (
    "MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA0/qBJhwN7cxncqsY/HfpKi9PJpFzKqfIBs2IlbH/6OnfLJZmOoO7GVA4efivLQBp3yS+eXRUNpkEbHnOSomAQNs6aKGtcTUmkMCacl8yCw6wCveLQDZTLEKjKBUjn4AaQ/X9dz9smcxVieZnbq2SWvSSfoPmPbsS8QraEJqX9N7MMUPksj1Jb+3IMBRgnD8+7vDtKxXWZGAzBqgn0MTQj3rmWMRt1Mm/55WUepL6P4HDdHBNjEeuEsut/UKKB6Kw40oz/IZ0jDQQ01V93cTUodKooct5JD4Sw8slfC0TiKcf/3angfNXpo2T/fJwp+9EAuN9kw2XhKU0LeAJyBohGFHRhFbXZ+EZggMZcG2NE/k0pJJahaco83lAP/PBzwnMlb8oLHnpeIw7PdVSON4F4Fn0mYfmY43f80JDB4FnWLAPwVekaZiwZv0hzHZlJhzR6owZ699f98bIKt05Ck/T4n0mysPCvJMPk1JMb7J5umtVpu9ObK7agshu+ilsmhj3AgMBAAE="
)
def seal(source: Path, output: Path) -> None:
    raw = source.read_bytes()
    obj = json.loads(raw)
    if obj.get("schema_version") != "explee.openoutfind.leads.v1" or not isinstance(obj.get("leads"), list):
        raise SystemExit("Unexpected normalized leads schema; refused upload")
    key = os.urandom(32)
    nonce = os.urandom(12)
    aad = b"explee-pipeline-qa-20261120"
    encrypted = AESGCM(key).encrypt(nonce, raw, aad)
    public_key = load_der_public_key(base64.b64decode(PUBLIC_KEY_DER_BASE64))
    wrapped = public_key.encrypt(key, padding.OAEP(mgf=padding.MGF1(algorithm=SHA256()), algorithm=SHA256(), label=None))
    b64 = lambda data: base64.b64encode(data).decode("ascii")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({
        "format": "explee-qa-aes256gcm-rsa-oaep-sha256-v1",
        "aad": b64(aad), "nonce": b64(nonce), "wrapped_key": b64(wrapped),
        "ciphertext": b64(encrypted)
    }, separators=(",", ":")) + "\n", encoding="utf-8")
    print("Encrypted QA report sealed (individual lead records not displayed)")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: explee_qa_seal.py leads.json sealed.json")
    seal(Path(sys.argv[1]), Path(sys.argv[2]))
