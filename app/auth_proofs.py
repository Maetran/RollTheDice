"""Request contracts shared by password and passkey account confirmation."""

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

AccountAction = Literal["change_username", "change_email", "change_password", "add_passkey", "delete_passkey"]
CONFIRMATION_FAILURES = {"current_password_invalid", "passkey_ceremony_invalid", "passkey_verification_failed"}


class PasskeyProof(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    credential: dict[str, Any]


class AccountConfirmation(BaseModel):
    current_password: str | None = Field(default=None, min_length=1, max_length=256)
    passkey: PasskeyProof | None = None

    @model_validator(mode="after")
    def exactly_one_confirmation(self):
        if (self.current_password is None) == (self.passkey is None):
            raise ValueError("exactly_one_confirmation_required")
        return self
