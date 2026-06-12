from typing import Callable
import customtkinter as ct
import tkinter as t

class InputBox(ct.CTkEntry):
    '''
    A class for a more
    detailed entry box.

    This class allows you
    to run the given function
    to check if the input
    change is acceptable
    '''
    def __init__(self, 
                 *args,  
                 acceptable: Callable[[str], bool] | None = None, 
                 enter_pressed: Callable | None = None,
                 **kwargs):
        super().__init__(*args, fg_color= "transparent", bg_color="transparent",**kwargs)

        self.acceptable: Callable[[str], bool] = (lambda x: None) if acceptable == None else acceptable
        self.vcmd = (self.register(self.on_validate), '%P')
        self.configure(validate="key", validatecommand=self.vcmd)
        self.enter_pressed = (lambda x : None) if enter_pressed==None else enter_pressed
        self.bind("<Return>", self.enter_pressed)


    @property
    def disabled(self) -> bool:
        if self.cget('state') == ct.DISABLED: return True
        else:                                 return False


    @disabled.setter
    def disabled(self, disable: bool) -> bool:
        self.configure(state=ct.DISABLED if disable else ct.NORMAL);
        return self.disabled;


    def set(self, value: str):
        '''
        Sets the current value
        inside of the entry
        '''
        was_disabled: bool = self.disabled
        if was_disabled: self.disabled = False
        self.delete(0, ct.END)
        self.insert(ct.END, value)
        if was_disabled: self.disabled = True


    def configure_input(self, require_redraw: bool = False, **kw):
        '''
        Configures the entry box.
        '''
        self.configure(require_redraw=require_redraw, **kw)


    def on_validate(self, possible_input: str):
        '''
        Checks to make sure that
        the inputted string is 
        acceptable.
        '''
        if self.acceptable(possible_input):
            return True
        elif possible_input == "":
            return True
        else: 
            return False