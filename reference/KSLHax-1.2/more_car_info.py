from typing import Any
import customtkinter as ct

from data_types import Car
from dataclasses import fields

class MoreCarInfo(ct.CTkToplevel):
    def __init__(self, *args, car: Car, **kwargs):
        super().__init__(*args, **kwargs)
        self.car = car
        car_info: str = self.__build_car_info(self.car)
        self.__init_ui(car_info)

    def __init_ui(self, car_info: str):
        self.title("More Information")
        self.geometry("600x1000")
        self.minsize(600, 1000)

        self.content = ct.CTkFrame(self)
        self.content.pack(fill=ct.BOTH, expand=True, padx=20, pady=20)

        self.info_box = ct.CTkTextbox(master=self.content, corner_radius=0, font=ct.CTkFont("Trebuchet MS", size=20), )
        self.info_box.insert(ct.END, car_info)
        self.info_box.configure(state=ct.DISABLED)
        self.info_box.pack(fill=ct.BOTH, expand=True)

        self.button = ct.CTkButton(master=self.content, text="Close", command=lambda : self.destroy())
        self.button.pack()

    def __build_car_info(self, data: Any, tab_count: int = 0):
        returnable = ""
        for field in fields(data):
            key = field.name
            value = getattr(data, key)
            tabs = "".join(['\t' for _ in range(tab_count)])

            if not isinstance(value, dict):
                returnable += f"{tabs}{key}: {value}\n"
            else:
                returnable+= f"{tabs}{key}:\n{self.__car_json(value, tab_count+1)}"

        return returnable.removesuffix('\n')
    
    def __car_json(self, data: dict, tab_count: int = 0)-> str:
        returnable = ""
        # print(data)
        for k,v in data.items():
            tabs = "".join(['\t' for _ in range(tab_count)])
            if not isinstance(v, dict):
                returnable+= f"{tabs}{k}: {v}\n"
            else:
                returnable+= f"{tabs}{k}:\n{self.__car_json(v, tab_count+1)}\n"
        print(returnable)
        return returnable.removesuffix('\n')