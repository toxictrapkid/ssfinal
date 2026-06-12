import customtkinter as ct
import threading as th
import typing as t
import queue as q

from utils import ImageLoader

class BackgroundTasks:
    '''
    This class manages the
    background tasks and
    foreground tasks
    created.

    To be more precise,
    background tasks are
    queued, and then ran
    in separate threads
    from the main thread.

    The foreground tasks
    are tasks that are 
    queued by (most likely)
    sub-threads to be ran
    in the main thread.
    '''
    def __init__(self, master: ct.CTkBaseClass):
        self.bg_tasks = q.Queue(3)
        self.fg_tasks = q.Queue(3)
        self.images = ImageLoader()
        self.master = master

        self.running_tasks: list[th.Thread] = []

        self.start()
        

    def clean_running(self):
        '''
        Remove references
        to threads that
        are no longer running
        '''
        self.running_tasks = [x for x in self.running_tasks if x.is_alive()]
        return self.running_tasks


    def update(self):
        '''
        Update all background
        and foreground tasks,
        if they are not empty
        '''
        if not self.bg_tasks.empty():
            self.update_bg()
        if not self.fg_tasks.empty():
            self.update_fg()


    def update_bg(self):
        '''
        Grabs queued background
        tasks and turns them into
        running threads.

        This is done in bites
        of 3. Every time this 
        function is ran, it 
        processes 3 more bg
        tasks that need to be
        completed
        '''
        self.clean_running()

        for _ in range(3):
            if self.bg_tasks.empty(): break

            gettable: tuple = self.bg_tasks.get()
            x = th.Thread(target=gettable[0], args=gettable[1])
            x.start()
            self.running_tasks.append(x)

    
    def update_fg(self):
        '''
        Grabs queued foreground
        tasks, and runs them
        directly.

        This is done in bites of
        3. Every time this function
        is ran, it runs 3 more 
        tasks.
        '''
        for _ in range(3):
            if self.fg_tasks.empty(): break
            gettable = self.fg_tasks.get()
            gettable[0](*gettable[1])


    def start(self):
        '''
        Start this object
        to be ran every
        200 miliseconds.
        '''
        self.update()        
        self.images.update()
        # Start this same function again
        self.master.after(200, self.start)


    def run_in_main(self, new_fun: t.Callable, /, args: tuple = ()) -> t.Literal[True]:
        '''
        Create a new 
        foreground task
        to be ran. This 
        task will be 
        queued and ran
        when possible
        '''
        self.fg_tasks.put((new_fun, args))
        return True


    def __call__(self, new_fun: t.Callable, /, args: tuple = ()) -> t.Literal[True]:
        '''
        Create a new
        background task
        to be ran. This
        task will be queued
        and ran when 
        possible.
        '''
        self.bg_tasks.put((new_fun, args))
        return True