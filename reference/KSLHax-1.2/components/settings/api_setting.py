import customtkinter as ct


from .settings_object import SettingsObject
from components.input_box import InputBox
from data_types import Configuration

class ApiSetting(SettingsObject):
    def __init__(self, master: ct.CTkBaseClass, data: Configuration):
        super().__init__(master, data, "Api")


    def __url_configs(self, content: ct.CTkBaseClass):
        self.url_box = InputBox(
            master=content, 
            placeholder_text="Url...", 
            font=ct.CTkFont("Trebuchet MS", 14),
            acceptable=self.verify_ksl,
            width=300
        )
        self.url_box.insert(ct.END, self.data.url)
        self.url_box.pack(side=ct.LEFT, fill=ct.X)

        self.reset_url_box = ct.CTkButton(master=content, text="↺", width=10, command=self.reset_url)
        self.reset_url_box.pack(side=ct.LEFT)

        self.break_point = ct.CTkFrame(master=content, fg_color="transparent", width=15, height=28)
        self.break_point.pack(side=ct.LEFT)

        self.page_box = InputBox(master=content, placeholder_text="Page Count", width=100, acceptable=lambda x : x.isdigit())
        self.page_box.insert(ct.END, str(self.data.page_count))
        self.page_box.pack(side=ct.LEFT)

    def _fill_content(self, content: ct.CTkBaseClass):
        # content.rowconfigure((0, 1),)
        content.columnconfigure(0)

        self.url_section = ct.CTkFrame(content)
        self.__url_configs(self.url_section)
        self.url_section.grid(row=0, column=0)

        self.user_agent = InputBox(master=content, placeholder_text="User Agent", font=ct.CTkFont("Trebuchet MS", 14), width=300, acceptable=lambda x: True)
        self.user_agent.insert(ct.END, self.data.user_agent)
        # self.user_agent.pack(side=ct.BOTTOM)
        self.user_agent.grid(row=1, column=0)

    def reset_url(self):
        self.url_box.delete(0, ct.END)
        self.url_box.insert(0, "https://cars.ksl.com/search/")

    def verify_ksl(self, future_possible: str):
        return "https://cars.ksl.com/search/" in future_possible
    
    def extract(self) -> dict:
        url = self.url_box.get()
        user_agent = self.user_agent.get()
        page_count = int(self.page_box.get())
        return {"url": url, "page_count": page_count, "user_agent": user_agent}
    