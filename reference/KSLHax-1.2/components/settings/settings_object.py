import customtkinter as ct
from abc import abstractmethod, ABC

from data_types import Configuration

class SettingsObject(ct.CTkFrame, ABC):
    def __init__(self, master: ct.CTkBaseClass, data: Configuration, title: str = "basic setting"):
        super().__init__(master=master, corner_radius=0)

        self.data = data
        self.__init__ui(title)


    def __init__ui(self, title):
        self.columnconfigure(0)
        self.columnconfigure(1)

        self.rowconfigure(0, weight=1)
        self.rowconfigure(1, weight=8)

        self.side_rectangle = ct.CTkFrame(self, corner_radius=0, width=10, height=1, fg_color=("#3B8ED0", "#1F6AA5"))
        self.side_rectangle.grid(row=0, rowspan=2, column=0, sticky=ct.NSEW)

        self.title_text = ct.CTkLabel(self, bg_color="transparent", text=title)
        self.title_text.grid(row=0, column=1, sticky=ct.NSEW)

        self.content_wrapper = ct.CTkFrame(self, corner_radius=0)
        self.content_wrapper.grid(row=1, column=1, sticky=ct.NSEW)

        self.content = ct.CTkFrame(self.content_wrapper, fg_color="transparent")
        self.content.pack(fill=ct.BOTH, padx=20, pady=20, expand=True)

        self._fill_content(self.content)


    @abstractmethod
    def _fill_content(self, content: ct.CTkBaseClass):
        pass


    @abstractmethod
    def extract(self) -> dict:
        return {}