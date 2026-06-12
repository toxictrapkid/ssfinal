class ProcessObject:
    def __init__(self, total_processes: int = 1):
        self._total_processes = total_processes
        self.completed_processes = 0


    @property
    def percentage_complete(self):
        return self.completed_processes / self.total_processes


    @property
    def total_processes(self):
        return self._total_processes


    @total_processes.setter
    def total_processes(self, value: int):
        self._total_processes = value
        return self.total_processes


    def complete_process(self):
        # self.process_completed()
        if self.completed_processes >= self.total_processes:
            return
        self.completed_processes+=1
    