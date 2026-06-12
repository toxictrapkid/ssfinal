import customtkinter as ct

from components import ConfigureMission

class Settings(ct.CTkToplevel):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.title("Settings")
        self.resizable(False, False)

        self.__init__ui()


    def __init__ui(self):
        self.mission_configure = ConfigureMission(master=self)
        self.mission_configure.pack(padx=20, pady=20)
        self.protocol("WM_DELETE_WINDOW", self.exit_settings)


    def exit_settings(self):
        self.mission_configure.extract()
        self.destroy()
