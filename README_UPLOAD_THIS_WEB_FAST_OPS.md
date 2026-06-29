{
  "generated_at": "2026-06-27T19:13:34.789Z",
  "version": "v1.8.2-infra-autopilot-20260628",
  "target_users": 1500000,
  "required_live_endpoints": [
    "/healthz",
    "/ops/redis",
    "/scanner/healthz",
    "/ops/wallet-capacity",
    "/ops/ton-signer",
    "/ops/final-gate"
  ],
  "ready_criteria": {
    "redis_ok": true,
    "scanner_workers_alive_minimum": 4,
    "wallet_capacity_gap_minimum": 0,
    "ton_signer_ok": true,
    "final_gate_ready_for_1_5m_public_traffic": true
  },
  "upload_packages": {
    "web_service": "UPLOAD_WEB_SERVICE_1_5M_PRODUCTION_LAUNCH_BUNDLE_2026-06-27.zip",
    "scanner_workers": "UPLOAD_SCANNER_WORKERS_1_5M_PRODUCTION_LAUNCH_BUNDLE_2026-06-27.zip",
    "full_bundle": "UPLOAD_1_5M_PRODUCTION_LAUNCH_BUNDLE_2026-06-27.zip"
  },
  "private_key_policy": "Never upload private-keys to GitHub, Render, Supabase, or frontend hosting."
}