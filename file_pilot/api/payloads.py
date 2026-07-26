"""API 请求体模型集中定义。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TargetProfileDirectoryPayload(BaseModel):
    path: str
    label: str | None = None
    description: str | None = None
    extensions: list[str] | None = None
    name_patterns: list[str] | None = None


class CreateSessionPayload(BaseModel):
    sources: list[dict[str, Any]] = Field(default_factory=list)
    target_dir: str | None = None
    resume_if_exists: bool = False
    organize_method: str | None = None
    unattended: bool = False
    strategy: dict[str, Any] | None = None
    output_dir: str | None = None
    target_profile_id: str | None = None
    target_directories: list[str] = Field(default_factory=list)
    target_directory_details: list[TargetProfileDirectoryPayload] = Field(default_factory=list)
    new_directory_root: str | None = None
    review_root: str | None = None


class MessagePayload(BaseModel):
    content: str


class ConfirmTargetsPayload(BaseModel):
    selected_target_dirs: list[str] = Field(default_factory=list)


class CreateTargetProfilePayload(BaseModel):
    name: str
    directories: list[TargetProfileDirectoryPayload] = Field(default_factory=list)


class UpdateTargetProfilePayload(BaseModel):
    name: str | None = None
    directories: list[TargetProfileDirectoryPayload] | None = None


class UpdateItemPayload(BaseModel):
    item_id: str
    target_dir: str | None = None
    target_slot: str | None = None
    move_to_review: bool = False


class RestoreAiMappingPayload(BaseModel):
    item_id: str


class ConfirmPayload(BaseModel):
    confirm: bool = False


class OpenDirPayload(BaseModel):
    path: str | None = None


class PresetSwitchPayload(BaseModel):
    preset_type: str
    id: str


class AddPresetPayload(BaseModel):
    preset_type: str
    name: str
    copy_profile: bool = Field(default=True, alias="copy")
    config: dict[str, Any] | None = None


class ConfigSecretsPayload(BaseModel):
    keys: list[str] = Field(default_factory=list)


class LlmTestPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    test_type: str = "text"


class SettingsSecretPayload(BaseModel):
    action: str = "keep"
    value: str | None = None


class SettingsFamilyUpdatePayload(BaseModel):
    preset: dict[str, Any] | None = None
    custom: dict[str, Any] | None = None
    secret: SettingsSecretPayload | None = None
    enabled: bool | None = None
    mode: str | None = None


class SettingsUpdatePayload(BaseModel):
    global_config: dict[str, Any] | None = None
    families: dict[str, SettingsFamilyUpdatePayload] = Field(default_factory=dict)


class SettingsPresetCreatePayload(BaseModel):
    name: str
    copy_from_active: bool = True
    preset: dict[str, Any] | None = None
    secret: SettingsSecretPayload | None = None


class SettingsTestPayload(BaseModel):
    family: str
    preset: dict[str, Any] | None = None
    secret: SettingsSecretPayload | None = None
    mode: str | None = None


class SettingsModelsPayload(BaseModel):
    family: str
    preset: dict[str, Any] | None = None
    secret: SettingsSecretPayload | None = None
    mode: str | None = None


class IconWorkbenchCreatePayload(BaseModel):
    target_paths: list[str] = Field(default_factory=list)


class IconWorkbenchTargetUpdatePayload(BaseModel):
    target_paths: list[str] = Field(default_factory=list)
    mode: str = "append"


class IconWorkbenchFolderBatchPayload(BaseModel):
    folder_ids: list[str] = Field(default_factory=list)


class IconWorkbenchPromptPayload(BaseModel):
    prompt: str


class IconWorkbenchSelectVersionPayload(BaseModel):
    version_id: str


class IconWorkbenchConfigPresetSwitchPayload(BaseModel):
    id: str


class IconWorkbenchConfigPresetCreatePayload(BaseModel):
    name: str
    config: dict[str, Any] | None = None


class IconWorkbenchTemplatePayload(BaseModel):
    name: str
    description: str = ""
    prompt_template: str


class IconWorkbenchTemplateUpdatePayload(BaseModel):
    name: str | None = None
    description: str | None = None
    prompt_template: str | None = None


class IconWorkbenchApplyTemplatePayload(BaseModel):
    template_id: str
    folder_ids: list[str] = Field(default_factory=list)


class IconWorkbenchClientActionResultPayload(BaseModel):
    folder_id: str | None = None
    folder_name: str | None = None
    folder_path: str | None = None
    version_id: str | None = None
    status: str
    message: str = ""


class IconWorkbenchClientActionReportPayload(BaseModel):
    action_type: str
    results: list[IconWorkbenchClientActionResultPayload] = Field(default_factory=list)
    skipped_items: list[IconWorkbenchClientActionResultPayload] = Field(default_factory=list)
