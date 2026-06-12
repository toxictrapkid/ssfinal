from background_tasks import BackgroundTasks
from dotenv import load_dotenv
from resources import ResourceManager
import customtkinter as ct
from gui import Gui

load_dotenv()
ct.set_appearance_mode('default')

class App(ct.CTk):
    '''
    The application class; the all
    encompassing class for the 
    application. Use the start 
    method to show the window
    '''
    def __init__(self) -> None:
        super().__init__()

        ResourceManager.verify_files()

        self.title("KSL Hax")
        self.background_tasks = BackgroundTasks(self)
        self.gui = Gui(master=self, tasks=self.background_tasks)


    def start(self):
        ct.set_widget_scaling(0.8)
        ct.set_window_scaling(0.8)

        self.geometry("1050x900")
        self.minsize(1050, 900)
        self.mainloop()