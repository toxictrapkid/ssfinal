from dataclasses import dataclass, field
from typing import Literal

@dataclass
class Car:
    price: int
    score: int = 0
    numberDoors: int = 4
    newUsed: str = "Unknown"
    displayTime: int = 0
    titleType: str = "Unknown"
    city: str = "Unknown"
    fuel: str = "Unknown"
    paint: list[str] = field(default_factory=list) 
    body: Literal["Coupe", "Sedan", "Hatchback"] | str = "Unkown"
    modifyTime: int = 0
    transmission: Literal["Automanual", "Automatic", "Manual"] | str = "Unkown"
    trim: str | None = None
    vin: str = "Unknown"
    model: str = "Unknown"
    id: int = 1234
    state: str = "Unknown"
    make: str = "Unknown"
    email: str = "Unknown"
    memberId: int = 0
    mileage: int = 1234
    contactMethod: list[Literal["phone","email","text","messages","phoneEmail"] | str] = field(default_factory=list) 
    zip: str = "Unknown"
    address1: str = "Unknown"
    makeYear: int = 1970
    photo: str | None = None
    firstName: str = "John (Doe)"
    primaryPhone: str = "Unknown"
    expireTime: int = 0
    mobilePhone: str = "Unknown"
    createTime: int = 0
    dealer: dict = field(default_factory=dict) 
    sellerType: Literal["Dealership", "For Sale By Owner"] | str = "Unkown"
    status: Literal["Active"] = "Active"
    favoritedByCurrentUser: bool = False
    newCar: bool = False