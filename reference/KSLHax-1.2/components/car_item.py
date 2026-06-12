from typing import Callable
import customtkinter as ct
import webbrowser as web
from PIL import Image

from background_tasks import BackgroundTasks
from resources import ResourceManager
from utils import ProcessObject
from data_types import Car
from more_car_info import MoreCarInfo

class CarItem(ct.CTkFrame):
    def __init__(self, 
                 *args, 
                 master: ct.CTkBaseClass, 
                 data: Car, 
                 process: ProcessObject, 
                 tasks: BackgroundTasks, 
                 finished: Callable, 
                 is_black_listed: bool,
                 add_blacklist: Callable[[int], None],
                 remove_blacklist: Callable[[int], None],
                 **kwargs):
        super().__init__(*args, master=master, **kwargs)

        self.data = data
        self.process = process
        self.tasks = tasks
        self.photo = None
        self.finished = finished

        self.add_blacklist = add_blacklist
        self.remove_blaclist = remove_blacklist

        print(f"New car discovered! {self.data.make} {self.data.model} {self.data.makeYear} {self.data.sellerType}")
        self._init_ui(is_black_listed)
    

    def _crop_image(self, image: Image.Image):
        '''
        Crops the image to be
        a square.
        '''
        width, height = image.size
        if width == height:
            return image
        offset  = int(abs(height-width)/2)
        if width>height:
            image = image.crop([offset,0,width-offset,height])
        else:
            image = image.crop([0,offset,width,height-offset])
        return image


    def _isolate_image_name(self, image_url: str):
        '''
        Isolate the image name from
        the url.

        Example
        -
        >>> _isolate_image_name('https://img.ksl.com/mx/mplace-cars.ksl.com/4826222-1684201630-965743.jpeg')
        '4826222-1684201630-965743.jpeg'
        '''
        found_start: bool = False
        returnable: str = ""
        # loop through the url from
        # the beginning until a number
        # is found
        for i in image_url:
            if not (found_start or i.isnumeric()): continue
            # Start adding each part of
            # the image to the returnable
            returnable+=i
            found_start=True
        return returnable


    def _get_image_thread(self, image_full_name: str, already_existed: bool):
        '''
        This method is ran when the 
        image thread has successfully
        retrieved the image.
        '''
        # Open Image
        opened_image: Image.Image = Image.open(image_full_name)
        
        if not already_existed:
            # Crop Image
            opened_image = self._crop_image( opened_image )
            # Re-save Image
            opened_image.save(image_full_name)
            # Set the Image
            
        self.ctk_image = ct.CTkImage(
            dark_image=opened_image, 
            light_image=opened_image, 
            size=(200, 200)
        )
        # Make sure self.photo exists
        # (because it is being created
        # in the main thread)
        while not self.photo: pass
        # Then set it to the new image
        self.photo.configure(require_redraw=True, image=self.ctk_image)
        self.finished()


    def _solve_image(self) -> Image.Image:
        '''
        Turn an image net URL into
        an image.

        Returns a temporary image,
        but gives the task to the
        image thread, and gives it 
        the class's callback 
        `_get_image_thread` to run
        upon the image's aquirement.
        '''
        # If the photo is absent
        if self.data.photo == None:
            # Mark this item as
            # finished loading
            self.finished()
            # And simply use the default image
            return Image.open(ResourceManager.default_image)
        
        # If the photo exists, get the base name
        image_name = self._isolate_image_name(self.data.photo)
        # attach the directory to the front
        image_full_name = f"{ResourceManager.cache_location}{image_name}"

        # and request it from the image thread
        return self.tasks.images("default", self.data.photo, image_full_name, self._get_image_thread)


    def _register_image(self) -> None:
        '''
        Set the self.ctk_image to 
        an image. Runs `_solve_image`
        to make the image.
        '''
        opened_image = self._solve_image()
        self.ctk_image = ct.CTkImage(
            dark_image=opened_image, 
            light_image=opened_image, 
            size=(200, 200)
        )


    def blacklist_toggle(self) -> None:
        '''
        Toggles the blacklist
        for the car item
        '''
        if self.blacklist_checkbox.get():
            self.add_blacklist(self.data.id)
        else:
            self.remove_blaclist(self.data.id)


    def _init_ui(self, is_black_listed: bool):
        '''
        Initializing and applying
        the UI to the item frame.
        '''
        # self.columnconfigure(0, weight=2)
        self.columnconfigure(1, weight=2)

        self.rowconfigure(0, weight=1)
        self.rowconfigure(1, weight=6)

        self.configure(fg_color="gray18" if not self.data.newCar else "gray22")

        self.process.complete_process()

        # Resolve the image
        self._register_image()
        self.photo = ct.CTkLabel(
            master=self, 
            image=self.ctk_image, 
            text="", 
            anchor=ct.W
        )
        self.photo.grid(column=0, row=0, rowspan=2, sticky=ct.NSEW)


        quotations = "\""
        self.title = ct.CTkLabel(
            master=self, 
            text=f"{self.data.make} {self.data.model} {f'{quotations}{self.data.trim}{quotations} ' if self.data.trim else ''}{self.data.makeYear} ({self.data.city}, {self.data.state})", 
            font=ct.CTkFont('Trebuchet MS', size=20), 
            compound=ct.LEFT,
            bg_color=("gray90", "gray24"),
            corner_radius=10
        )
        self.title.grid(column=1, row=0, sticky=ct.NSEW)

        self.content = ct.CTkFrame(master=self, fg_color="transparent")
        self.content.grid(column=1, row=1, sticky=ct.NSEW, padx=10, pady=10)

        self.content.rowconfigure((0, 1, 2), weight=1)
        self.content.columnconfigure((0, 1, 2), weight=1)

        self.url_button = ct.CTkButton(master=self.content, text="Open in Browser", command=(lambda : web.open(f"https://cars.ksl.com/listing/{self.data.id}")))
        self.url_button.grid(row=0, column=0)

        self.blacklist_checkbox = ct.CTkCheckBox(master=self.content, text="Blacklist Item", command=self.blacklist_toggle, variable=ct.IntVar(value=is_black_listed))
        self.blacklist_checkbox.grid(row=2, column=0)

        self.score_label = ct.CTkLabel(master=self.content, text=f"Score: {self.data.score}", font=ct.CTkFont("Trebuchet MS", size=20))
        self.score_label.grid(row=2, column=1)

        self.price_label = ct.CTkLabel(master=self.content, text=f"Price: ${self.data.price:,}", font=ct.CTkFont("Trebuchet MS", size=20))
        self.price_label.grid(row=0, column=1)
 
        self.dealer = ct.CTkLabel(master=self.content, text=self.data.sellerType, font=ct.CTkFont("Trebuchet MS", size=20))
        self.dealer.grid(row=0, column=2)

        self.more_info = ct.CTkButton(master=self.content, text="More Info", command=(lambda : MoreCarInfo(car=self.data).grab_set()))
        self.more_info.grid(row=2, column=2)

        self.process.complete_process()
