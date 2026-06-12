import customtkinter as ct
from dacite import from_dict

from resources import ResourceManager
from data_types import Configuration
from .settings import settingable

class ConfigureMission(ct.CTkFrame):
    '''
    Class for holding settings
    for configuring how the
    program requests from the
    KSL server.
    '''
    def __init__(self, *args, master: ct.CTkBaseClass, **kw):
        super().__init__(*args, master=master, **kw)

        self.data: Configuration = ResourceManager.configuration_data.get_configuration()

        self._init_ui()


    def _init_ui(self):
        '''
        Sets up all of the
        pieces of the UI
        based off of the
        settingable variable
        inside of the 
        '''
        self.all_settings = []
        for setting in settingable:
            current_setting = setting(self, self.data)
            current_setting.pack(anchor=ct.W, fill=ct.X)
            self.all_settings.append(current_setting)


    def extract(self) -> Configuration:
        writable = {}
        for i in self.all_settings:
            writable.update(i.extract())
        ResourceManager.configuration_data.write(writable)
        return from_dict(Configuration, writable)
    