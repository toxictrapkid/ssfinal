from .backup_object import BackupObject
from data_types import Configuration
from dacite import from_dict

class ConfigurationData(BackupObject):
    def __init__(self):
        super().__init__("configuration_data.json", json=True)

    def get_configuration(self):
        return from_dict(Configuration, self.read())