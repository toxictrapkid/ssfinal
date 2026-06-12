import customtkinter as ct

from .errors import ErrorData

class TopErrorWindow(ct.CTkToplevel):
    '''
    A class for Error Windows
    that appear on top of
    an existing window
    '''
    def __init__(self, error_data: ErrorData):
        super().__init__()
        self._start_ui(error_data.title, error_data.text, error_data.error)


    def _start_ui(self, title: str, text: str, error: str):
        self.title(title)
        self.content = ct.CTkFrame(self)
        self.content.pack(fill=ct.BOTH, expand=True, padx=20, pady=20)

        self.text = ct.CTkLabel(master=self.content, text=text, bg_color="transparent")
        self.text.pack()

        self.error = ct.CTkTextbox(master=self.content, corner_radius=0)
        self.error.insert(ct.END, error)
        self.error.configure(state=ct.DISABLED)
        self.error.pack(fill=ct.BOTH, expand=True)

        self.button = ct.CTkButton(master=self.content, text="Close", command=lambda : self.destroy())
        self.button.pack()
    
    def start(self):
        self.geometry("600x400")
        self.minsize(600, 400)

class ApplicationErrorWindow(ct.CTk):
    '''
    A class for Error Windows
    that need to become their
    own application, and their
    own mainloop.
    '''
    def __init__(self, error_data: ErrorData):
        super().__init__()
        self._start_ui(error_data.title, error_data.text, error_data.error)


    def _start_ui(self, title: str, text: str, error: str):
        self.title(title)
        self.content = ct.CTkFrame(self)
        self.content.pack(fill=ct.BOTH, expand=True, padx=20, pady=20)

        self.text = ct.CTkLabel(master=self.content, text=text, bg_color="transparent")
        self.text.pack()

        self.error = ct.CTkTextbox(master=self.content, corner_radius=0)
        self.error.insert(ct.END, error)
        self.error.configure(state=ct.DISABLED)
        self.error.pack(fill=ct.BOTH, expand=True)

        self.button = ct.CTkButton(master=self.content, text="Close", command=lambda : self.destroy())
        self.button.pack()
    
    def start(self):
        self.geometry("600x400")
        self.minsize(600, 400)
        self.mainloop()