from fastapi import HTTPException
from sqlalchemy.orm import Session


def get_or_404[T](db: Session, model: type[T], id_: int) -> T:
    obj = db.get(model, id_)
    if obj is None:
        raise HTTPException(404, f"{model.__name__} {id_} not found")
    return obj
