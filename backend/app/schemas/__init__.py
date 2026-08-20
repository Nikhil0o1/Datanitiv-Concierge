from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"


class ProgramOut(BaseModel):
    id: int
    name: str
    plan_count: int = 0
    net_ou: float = 0.0

    model_config = {"from_attributes": True}


class SiteOut(BaseModel):
    id: int
    name: str
    region: str

    model_config = {"from_attributes": True}


class WeekOut(BaseModel):
    week_idx: int
    week_label: str
    ou: float
    shrink_actual: float | None
    shrink_plan: float | None
    projected: float
    required: float

    model_config = {"from_attributes": True}


class HeadcountOut(BaseModel):
    opening: float
    nest: float
    tin: float
    tout: float
    loa_in: float
    loa_out: float
    attr: float
    promo: float
    closing: float

    model_config = {"from_attributes": True}


class RosterClassOut(BaseModel):
    id: int
    class_name: str
    class_date: str
    wk_rel: int
    plan_hc: float
    actual_hc: float
    train_hc: float
    status: str
    train_wk: int
    nest_wk: int

    model_config = {"from_attributes": True}


class PlanSummary(BaseModel):
    cap_id: str
    plan_name: str
    program: str
    site: str
    region: str
    lob: str
    planner: str
    vertical: str
    is_vol: bool
    cur_week_idx: int
    ou: float
    sustained: float
    min_ou_fwd: float
    closing_fte: float
    shrink12: float
    attr12: float
    billable: float
    has_roster_gap: bool = False


class PlanDetail(PlanSummary):
    avail_hrs: float
    weeks: list[WeekOut]
    headcount: HeadcountOut | None = None
    roster_classes: list[RosterClassOut] = Field(default_factory=list)


class TriagePlanItem(BaseModel):
    cap_id: str
    plan_name: str
    program: str
    lob: str
    site: str
    sustained: float
    min_ou_fwd: float
    why: str
    tag: str
    tag_class: str
    has_roster_gap: bool = False


class TriageResponse(BaseModel):
    dec: list[TriagePlanItem]
    auto: list[TriagePlanItem]
    quiet: list[TriagePlanItem]
    counts: dict[str, int]


class PlanningCycleOut(BaseModel):
    id: int
    week_label: str

    model_config = {"from_attributes": True}


class ActionPackageOut(BaseModel):
    id: int
    cap_id: str
    ot_hrs: float
    xu_fte: float
    hire_count: int
    status: str
    description: str
    plan_name: str | None = None

    model_config = {"from_attributes": True}


class ActionPackagePatch(BaseModel):
    status: str | None = None
    ot_hrs: float | None = None
    xu_fte: float | None = None
    hire_count: int | None = None


class ExecuteQueueRequest(BaseModel):
    package_ids: list[int]


class ExecuteQueueResponse(BaseModel):
    posted: list[int]
    message: str


class LedgerEntryOut(BaseModel):
    id: int
    label: str
    minutes: int

    model_config = {"from_attributes": True}


class LedgerResponse(BaseModel):
    entries: list[LedgerEntryOut]
    total_minutes: int
    remaining_minutes: int


class MemoryOut(BaseModel):
    id: int
    rule_text: str
    source: str
    applied_count: int
    confidence: str

    model_config = {"from_attributes": True}


class ShrinkageWeekUpdate(BaseModel):
    week_idx: int
    shrink_plan: float


class ShrinkageSubmitRequest(BaseModel):
    weeks: list[ShrinkageWeekUpdate]


class ShrinkageSubmitResponse(BaseModel):
    cap_id: str
    updated_weeks: list[WeekOut]
    net_requirement_change: float


class RosterMapRequest(BaseModel):
    class_id: int | None = None
    train_hc: float | None = None


class RosterMapResponse(BaseModel):
    cap_id: str
    mapped_fte: float
    projected_adjustment: float
    status: str


class VoiceSTTResponse(BaseModel):
    text: str


class VoiceTTSRequest(BaseModel):
    text: str
    voice_id: str = "21m00Tcm4TlvDq8ikWAM"


class AgentChatMessage(BaseModel):
    role: str
    content: str


class AgentChatRequest(BaseModel):
    message: str
    context_cap_id: str | None = None
    ui_state: dict | None = None
    history: list[AgentChatMessage] = Field(default_factory=list)
    source: str | None = None  # "text" | "voice"


class AgentChatResponse(BaseModel):
    reply: str
    intent: str | None = None
    actions: list[dict] = Field(default_factory=list)
