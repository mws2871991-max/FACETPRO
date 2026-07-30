# Facet Pro Backend (FastAPI)
- FastAPI + SQLAlchemy + Postgres (SQLite for local dev)
- Auth: bcrypt + JWT for installers, homeowners unauthenticated
- Services:
  - app/services/vision_detector.py -> GPT-4o vision, model_type reaches UI (mock fallback amber banner)
  - app/services/image_transformer.py -> Replicate FLUX Kontext Pro, 5-render cap per design, 3/min rate limit
  - app/services/roofline.py -> pyproj WGS84 geodesic area
  - app/services/facade.py -> calibration + box measure + sanity validation
- Endpoints:
  POST /designs/upload, POST /designs/{id}/detect, PATCH /designs/{id}/selections, POST /designs/{id}/save, GET /installers/me/jobs, POST /installers/me/survey
