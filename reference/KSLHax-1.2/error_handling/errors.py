from dataclasses import dataclass

@dataclass
class ErrorData:
    title: str = "An Error Ocurred"
    text: str = "The Folowing Error Ocurred:"

    simple_msg: str = ""
    stack_trace: str = ""

    def is_empty(self) -> bool:
        '''
        Check if this error
        is empty; aka it 
        has no message.
        '''
        return self.simple_msg == "" and self.stack_trace == ""
    
    @property
    def error(self):
        if self.simple_msg:
            return f"{self.simple_msg}\n\n{self.stack_trace}"
        else:
            return self.stack_trace
        
class DescriptiveException(Exception):
    def __init__(self, message: ErrorData) -> None:
        self.message = message
        super().__init__(message)

class CompletelyDestroyedException(DescriptiveException): pass