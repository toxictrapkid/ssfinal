import json
import os

class ResourceObject:
    global_save_location = "state/"

    def __init__(self, base_name: str, /, save_location: str | None = None, json: bool = False, default: str = ""):
        self._base_name = base_name
        self._save_folder = save_location if save_location else self.global_save_location
        self._json = json
        self._default = default


    @property
    def save_location(self):
        return f"{self._save_folder}{self._base_name}"


    @property
    def base_name(self):
        return self._base_name
    
    def write(self, data: str | dict | list):
        if type(data) != str and self._json: data = json.dumps(data, indent=4)
        elif type(data) != str: raise TypeError("For non JSON resources, only strings are allowed.")
        with open(repr(self), 'w') as f:
            f.write(data)
    
    
    def read(self):
        data: str
        with open(self.__repr__(), 'r') as f:
            data = f.read()
        if not self._json: return data
        else:              return json.loads(data)

    
    def verify(self):
        if not os.path.isfile(repr(self)):
            self.write(self._default)
    

    def __repr__(self) -> str:
        return self.save_location