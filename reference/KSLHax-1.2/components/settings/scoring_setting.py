import customtkinter as ct
import webbrowser
import shutil
import os

from .settings_object import SettingsObject
from resources import ResourceManager
from data_types import Configuration

class ScoringSetting(SettingsObject):
    def __init__(self, master: ct.CTkBaseClass, data: Configuration):
        super().__init__(master=master, data=data, title="Scoring")


    def _fill_content(self, content: ct.CTkBaseClass):
        # SCORING BOX
        # ==========
        # self.scoring_box = ct.CTkFrame(master=content)
        # self.scoring_box.grid(row=0, column=0, sticky=ct.NS)
        self.score_location = self.data.score_script_location
        # Scoring configure
        content.rowconfigure(0, weight=1)
        content.rowconfigure(1, weight=3)
        
        content.columnconfigure(0)
        content.columnconfigure(1, pad=20)
        content.columnconfigure(2)

        # Scoring elements
        # self.scoring_text = ct.CTkLabel(master=content, text="Scoring", bg_color="transparent")
        # self.scoring_text.grid(row=0, column=0, columnspan=3, sticky=ct.NSEW)

        self.profile_list = ct.CTkComboBox(master=content, command=self.profile_changed, width=250)
        self.reset_profile_values()
        self.profile_list.set(self.score_location)
        self.profile_list.grid(row=1, column=0)

        self.add_profile_button = ct.CTkButton(master=content, width=28, height=28, text="+", command=self.add_profile)
        self.add_profile_button.grid(row=1, column=1, sticky=ct.W)

        self.open_script = ct.CTkButton(master=content, height=28, text="Open Script", command=self.open_script_command)
        self.open_script.grid(row=1, column=2)


    def reset_profile_values(self):
        # Setting up combo box
        # Put all scoring files into a list
        values: list[str] = ["scoring/"+f for f in os.listdir(ResourceManager.scoring_location) if os.path.isfile(os.path.join(ResourceManager.scoring_location, f))]
        # If the score file that originally existed doesn't, reselect the default
        if not self.score_location in values:
            self.score_location = ResourceManager.default_scoring_script
        self.profile_list.configure(values=values)


    def profile_changed(self, value):
        self.score_location = value


    def open_script_command(self):
        replace_old = '\\'
        os.startfile(f"{os.getcwd().replace(replace_old, '/')}/{self.score_location}")


    def add_profile(self):
        count = 1
        script_end_location = f"{ResourceManager.scoring_location}new_scoring_method{count}.py"
        while os.path.isfile(script_end_location):
            count+=1
            script_end_location = f"{ResourceManager.scoring_location}new_scoring_method{count}.py"

        shutil.copy(ResourceManager.new_script_location, script_end_location)
        self.reset_profile_values()

    def extract(self) -> dict:
        return {"score_script_location": self.score_location}