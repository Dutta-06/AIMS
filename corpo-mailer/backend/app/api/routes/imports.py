from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services import csv_import as svc

router = APIRouter()


class ImportIn(BaseModel):
    csv: str = Field(max_length=5_000_000, description="The CSV file's text")
    overwrite: bool = Field(default=False, description="Let the sheet override what is in the app")
    infer_status: bool = Field(
        default=True, description="Treat remarks like 'mail sent' as Contacted when status is blank"
    )


def _plan(body: ImportIn, db: Session) -> svc.Plan:
    try:
        return svc.plan_import(db, body.csv, body.overwrite, body.infer_status)
    except svc.ImportError_ as exc:
        raise HTTPException(422, str(exc)) from None


@router.post("/import/preview")
def preview(body: ImportIn, db: Session = Depends(get_db)):
    """Show exactly what an import would do. Nothing is saved."""
    plan = _plan(body, db)
    shown = [r.public() for r in plan.rows[:2000]]
    return {
        "summary": plan.summary(),
        "rows": shown,
        "truncated": len(plan.rows) > 2000,
        **plan.meta,
    }


@router.post("/import/commit")
def commit(body: ImportIn, db: Session = Depends(get_db)):
    """Apply the same plan the preview showed."""
    return svc.apply_plan(db, _plan(body, db))


@router.get("/export.csv")
def export(db: Session = Depends(get_db)):
    return Response(
        svc.export_csv(db),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="corpo-mailer-leads.csv"'},
    )
