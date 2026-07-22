"""Host-agnostic interaction-memory and residual-injection primitives."""

from .intent_iadm import (
    CausalSurfaceContactProposer,
    IADMContactDecoder,
    IntentGuidedContactFusion,
    IntentMotionContactFieldBuilder,
    P78CausalIntentMotion,
    p78_causal_repair_loss,
    run_sensitivity_contract,
)
from .remogen_mim import ReMoGenMIMBlock, ReMoGenRelationBias

__all__ = [
    "CausalSurfaceContactProposer",
    "IADMContactDecoder",
    "IntentGuidedContactFusion",
    "IntentMotionContactFieldBuilder",
    "P78CausalIntentMotion",
    "ReMoGenMIMBlock",
    "ReMoGenRelationBias",
    "p78_causal_repair_loss",
    "run_sensitivity_contract",
]
