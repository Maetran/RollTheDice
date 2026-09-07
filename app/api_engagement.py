from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from .auth import require_csrf, require_user
from .engagement import record_engagement

router = APIRouter(prefix="/api/account", tags=["engagement"])


class EngagementRequest(BaseModel):
    event: str = Field(min_length=1, max_length=64)


@router.post("/engagement")
def engagement(payload: EngagementRequest, request: Request):
    identity = require_user(request)
    require_csrf(request, identity)
    return record_engagement(identity.user_id, payload.event)
