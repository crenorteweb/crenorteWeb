import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NovomoduloComponent } from './novomodulo.component';

describe('NovomoduloComponent', () => {
  let component: NovomoduloComponent;
  let fixture: ComponentFixture<NovomoduloComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NovomoduloComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NovomoduloComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
