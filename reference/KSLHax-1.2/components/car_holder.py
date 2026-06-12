import customtkinter as ct
from typing import Any
from itertools import chain
from dataclasses import asdict

from utils import ProcessObject, PaginationHelper
from resources import ResourceManager
from .labeled_progress import LabeledProgress
from background_tasks import BackgroundTasks
from .input_box import InputBox
from .car_item import CarItem
from data_types import Car

class CarHolder(ct.CTkFrame, ProcessObject, PaginationHelper):
    '''
    A class that holds and
    shows cars to the user.

    This class breaks the 
    list into multiple pages
    that can be crawled through.
    '''
    def __init__(self, *args: Any, master: ct.CTkBaseClass, root_window: ct.CTkBaseClass, data: list[Car], progress: LabeledProgress | None, tasks: BackgroundTasks, **kwargs: Any):
        ct.CTkFrame.__init__(self, *args, master=master, **kwargs)
        ProcessObject.__init__(self, 6)
        PaginationHelper.__init__(self, data, 3)
        
        self.tasks = tasks
        self.progress = progress
        self.car_items: list[CarItem] = []
        self.page_changing_allowed: bool = False
        self.pending_blacklist: list[int] = []

        self._init_ui()

        root_window.bind("<Left>", lambda e: self.left_button_clicked())
        root_window.bind("<Right>", lambda e: self.right_button_clicked())

        self.page = 0


    def _init_ui(self):
        '''
        Initializes the UI,
        and places it into
        the UI.
        '''
        self.rowconfigure(0, weight=10)
        self.rowconfigure(1, weight=1)

        self.columnconfigure(0, weight=1)

        self.content = ct.CTkFrame(master=self, corner_radius=0)
        self.content.grid(row=0, column=0, sticky=ct.NSEW)

        self.empty_buffer_text = ct.CTkLabel(master=self.content, text="BUFFER EMPTY", font=ct.CTkFont('Trebuchet MS', 48, weight='bold'), bg_color="transparent")

        # ==================
        # BOTTOM BAR CONTENT
        # ==================
        self.bottom_bar = ct.CTkFrame(master=self, corner_radius=0, fg_color="transparent")

        self.bottom_bar.rowconfigure(0, weight=1)
        
        self.bottom_bar.columnconfigure((0, 1, 2), weight=1)

        self.left_button = ct.CTkButton(master=self.bottom_bar, width=35, height=40, text="←", command=self.left_button_clicked)
        self.left_button.grid(row=0, column=0, sticky=ct.W)

        self.bottom_center_content = ct.CTkFrame(master=self.bottom_bar, width=40, height=28, fg_color="transparent")
        self.bottom_center_content.grid(row=0, column=1, sticky=ct.NS)

        self.new_page_input = InputBox(master=self.bottom_center_content, width=48, acceptable=lambda x : x.isdigit(), enter_pressed=self.page_change)
        self.new_page_input.pack(side=ct.LEFT)

        self.all_pages_label = ct.CTkLabel(master=self.bottom_center_content, text=f"/ {self.page_count()}")
        self.all_pages_label.pack(side=ct.LEFT)

        self.right_button = ct.CTkButton(master=self.bottom_bar, width=35, height=40, text="→", command=self.right_button_clicked)
        self.right_button.grid(row=0, column=2, sticky=ct.E)

        self.bottom_bar.grid(row=1, column=0, sticky=ct.NSEW)

    @property
    def page(self) -> list[Car]:
        '''
        Gives the page we are on
        '''
        return self._page


    @page.setter
    def page(self, value):
        '''
        Changes the page
        we are viewing 
        '''
        new_page = value % len(self.collection)
        if hasattr(self, "_page") and new_page == self._page: return
        self._page = new_page
        self.amount_finished = 0
        self.deactivate_buttons()
        self.update_page()
        self.new_page_input.set(str(self._page+1))
        return self.page
    
    
    def page_change(self, _):
        '''
        Set the page based off
        of the input given.
        '''
        self.page = int(self.new_page_input.get())-1
        self.new_page_input.set(str(self._page+1))

    def car_item_finished(self):
        '''
        Ran when a car item is
        finished loading.

        When all car items are
        finished loading, 
        reactivate the buttons
        to allow switching
        between pages.
        '''
        self.amount_finished+=1
        if self.amount_finished==self.page_item_count(self.page):
            self.activate_buttons()
    

    def clear_content(self):
        '''
        Clears all the 
        car items 
        presented.
        '''
        while len(self.car_items) > 0:
            self.car_items[0].destroy()
            del self.car_items[0]


    def update_page(self):
        '''
        Clears the current
        car items, and 
        adds the cars 
        corresponding to the
        current page.
        '''
        self.clear_content()

        if len(self.collection[self._page]) == 0:
            self.empty_buffer_text.pack(fill=ct.BOTH, expand=True)
            return;

        self.empty_buffer_text.pack_forget()
        for count,item in enumerate(self.collection[self._page]):
            item: Car
            self.car_items.append( CarItem(master=self.content, 
                                           data=item, 
                                           process = self, 
                                           tasks=self.tasks, 
                                           finished=self.car_item_finished,
                                           is_black_listed=item.id in self.pending_blacklist,
                                           add_blacklist=lambda x: self.pending_blacklist.append(x),
                                           remove_blacklist=lambda x: self.pending_blacklist.remove(x)
                                           ) 
                                 )
            self.car_items[count].pack(fill=ct.X, padx=5, pady=2)


    def left_button_clicked(self):
        if not self.page_changing_allowed: return
        self.page = self.page-1
    

    def right_button_clicked(self):
        if not self.page_changing_allowed: return
        self.page = self.page+1


    def deactivate_buttons(self):
        self.left_button.configure(state=ct.DISABLED)
        self.right_button.configure(state=ct.DISABLED)
        self.new_page_input.configure(state=ct.DISABLED)
        self.page_changing_allowed = False


    def activate_buttons(self):
        self.left_button.configure(state=ct.NORMAL)
        self.right_button.configure(state=ct.NORMAL)
        self.new_page_input.configure(state=ct.NORMAL)
        self.page_changing_allowed = True


    def process_completed(self):
        if self.progress != None:
            self.progress.set(self.percentage_complete)


    def apply_blacklist(self):
        '''
        Applies the blacklistings
        that were selected.
        '''
        if len(self.pending_blacklist) == 0: return

        black = ResourceManager.blacklist_data.read()
        black.extend(self.pending_blacklist)
        ResourceManager.blacklist_data.write(black)

        data: list[Car] = chain.from_iterable(self.collection)
        data = [asdict(i) for i in data if not i.id in self.pending_blacklist]
        ResourceManager.scored_data.write(data)


    def cleanup(self):
        '''
        Should be ran when the
        car holder is destroyed.
        '''
        print("Did the exit")
        self.apply_blacklist()
