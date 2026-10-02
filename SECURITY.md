# AKSARA Security Notes

The public website is intentionally limited to accreditation master data and published Integration Matrix metadata. Evidence files and operational readiness data require authenticated access and RLS.

Key controls:
- Supabase publishable key only in browser.
- RLS enabled across application tables.
- Private Storage bucket.
- Storage policies authorize through evidence/EP scope.
- Verification authorization is scope-aware.
- Audit trail is trigger generated and write-protected from authenticated clients.
- No patient-level clinical data is part of the public master dataset.

Operational rule: do not upload patient-identifiable documents to a public repository. Upload evidence only to the private Supabase Storage bucket through Aksara.
