from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import Company, Prospect
from app.models.enums import ProspectState, Verdict
from app.providers.llm import LLM, get_llm
from app.providers.search import SearchClient, get_search
from app.providers.web import PageFetcher, get_fetcher
from app.schemas import api as s
from app.services import discovery as svc

router = APIRouter()

_ORDER = {Verdict.VERIFIED: 0, Verdict.NEEDS_CHECK: 1, Verdict.UNVERIFIED: 2, Verdict.FAILED: 3}


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except svc.DiscoveryError as exc:
        raise HTTPException(409, str(exc)) from None


@router.get("", response_model=list[s.ProspectOut])
def list_prospects(state: str = "new", db: Session = Depends(get_db)):
    """`state` is new (default), snoozed, rejected, accepted or all."""
    svc.wake_snoozed(db)
    stmt = select(Prospect)
    if state != "all":
        try:
            stmt = stmt.where(Prospect.state == ProspectState(state))
        except ValueError:
            raise HTTPException(422, "Unknown state") from None
    rows = db.scalars(stmt.order_by(Prospect.created_at.desc(), Prospect.id.desc())).all()
    return sorted(rows, key=lambda p: _ORDER[p.verdict])


@router.post("/suggest", response_model=s.SuggestOut)
def suggest(
    body: s.SuggestIn,
    db: Session = Depends(get_db),
    llm: LLM = Depends(get_llm),
    settings: Settings = Depends(get_settings),
):
    """Ask the model for lookalike companies. They arrive unverified; nothing is trusted yet."""
    try:
        return svc.suggest(db, llm, settings, body.count, body.focus)
    except svc.DiscoveryError as exc:
        raise HTTPException(502, str(exc)) from None


@router.post("/search", response_model=list[s.SearchHitOut])
def search_pages(body: s.SearchIn, search: SearchClient = Depends(get_search)):
    """Search the web for pages that list sponsors. Returns pages only; nothing is saved."""
    try:
        return svc.find_sponsor_pages(search, body.query)
    except svc.DiscoveryError as exc:
        raise HTTPException(502, str(exc)) from None


@router.post("/from-page", response_model=s.FromPageOut)
def from_page(
    body: s.FromPageIn,
    db: Session = Depends(get_db),
    fetcher: PageFetcher = Depends(get_fetcher),
):
    """Pull candidate companies out of a page that lists sponsors (no model involved)."""
    return _guard(svc.extract_sponsors, db, fetcher, body.url.strip())


@router.post("/enrich/{company_id}", response_model=s.EnrichOut)
def enrich_company(
    company_id: int,
    db: Session = Depends(get_db),
    fetcher: PageFetcher = Depends(get_fetcher),
    llm: LLM = Depends(get_llm),
):
    """Report what a tracked company's own website shows. Saves nothing."""
    company = get_or_404(db, Company, company_id)
    try:
        return svc.enrich(db, fetcher, llm, company)
    except svc.DiscoveryError as exc:
        raise HTTPException(502, str(exc)) from None


@router.post("/enrich/{company_id}/apply", response_model=s.EnrichApplyOut)
def apply_enrichment(
    company_id: int,
    body: s.EnrichApplyIn,
    db: Session = Depends(get_db),
    fetcher: PageFetcher = Depends(get_fetcher),
    llm: LLM = Depends(get_llm),
):
    """Save the chosen findings. The site is checked again; only what it still shows is saved."""
    company = get_or_404(db, Company, company_id)
    return _guard(svc.apply_enrichment, db, fetcher, llm, company, body.set_website, body.emails)


@router.post("/{prospect_id}/verify", response_model=s.ProspectOut)
def verify(
    prospect_id: int,
    body: s.VerifyIn | None = None,
    db: Session = Depends(get_db),
    fetcher: PageFetcher = Depends(get_fetcher),
    settings: Settings = Depends(get_settings),
):
    """Open the company's website and record what is really there."""
    p = get_or_404(db, Prospect, prospect_id)
    if body and body.website and body.website.strip():
        site, domain = svc.clean_website(body.website)
        if not site:
            raise HTTPException(422, "That doesn't look like a website address")
        p.website, p.domain = site, domain
    return _guard(svc.verify, db, fetcher, settings, p)


@router.post("/{prospect_id}/accept", response_model=s.AcceptOut)
def accept(prospect_id: int, db: Session = Depends(get_db)):
    p = get_or_404(db, Prospect, prospect_id)
    company = _guard(svc.accept, db, p)
    return {"company_id": company.id, "prospect": p}


@router.post("/{prospect_id}/reject", response_model=s.ProspectOut)
def reject(prospect_id: int, db: Session = Depends(get_db)):
    return _guard(svc.reject, db, get_or_404(db, Prospect, prospect_id))


@router.post("/{prospect_id}/snooze", response_model=s.ProspectOut)
def snooze(prospect_id: int, body: s.SnoozeIn | None = None, db: Session = Depends(get_db)):
    days = body.days if body else 30
    return _guard(svc.snooze, db, get_or_404(db, Prospect, prospect_id), days)
