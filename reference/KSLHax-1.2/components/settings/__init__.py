from .scoring_setting import ScoringSetting
from .api_setting import ApiSetting

from .settings_object import SettingsObject

settingable: list[SettingsObject] = [ScoringSetting, ApiSetting]