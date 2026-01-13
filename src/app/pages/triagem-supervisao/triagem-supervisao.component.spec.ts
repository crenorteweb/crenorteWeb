import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TriagemSupervisaoComponent } from './triagem-supervisao.component';

describe('TriagemSupervisaoComponent', () => {
  let component: TriagemSupervisaoComponent;
  let fixture: ComponentFixture<TriagemSupervisaoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TriagemSupervisaoComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TriagemSupervisaoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
