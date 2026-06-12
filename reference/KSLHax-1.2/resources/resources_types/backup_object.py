from .resource_object import ResourceObject
from error_handling import ErrorData, CompletelyDestroyedException
import traceback
import shutil
import os

class BackupObject(ResourceObject):
    global_backups_location = "backups/"

    def __init__(self, base_name: str, /, save_location: str | None = None, json: bool = False):
        super().__init__(base_name, save_location, json)
        self._default = self.read_backup()
        self.safely_restore()


    @property
    def backup_location(self):
        return f"{self.global_backups_location}{self._base_name}"


    def safely_restore(self) -> bool:
        '''
            Returns True if the file
            was restored.
        '''
        if not os.path.isfile(self.save_location):
            self.restore()
            return True
        return False
    
    
    def read_backup(self) -> str:
        returnable: str
        try:
            with open(self.backup_location, 'r') as f:
                returnable = f.read()
            return returnable
        except FileNotFoundError:
            raise CompletelyDestroyedException(
                ErrorData(text=f"Well, the backups are gone. Ya done did.",
                          simple_msg=f"Resource \"{self._base_name}\" is missing, corrupt, or destroyed.",
                          stack_trace=traceback.format_exc()
                          )
            )


    def restore(self):
        if not os.path.isfile(self.backup_location):
            raise CompletelyDestroyedException(
                ErrorData(text=f"Well, the backups are gone. Ya done did.",
                          simple_msg=f"Resource \"{self._base_name}\" is missing, corrupt, or destroyed.",
                          stack_trace=traceback.format_exc()
                         )
            )
        if not os.path.isdir(self._save_folder):
            os.mkdir(self._save_folder)
        shutil.copyfile(self.backup_location, self.save_location)